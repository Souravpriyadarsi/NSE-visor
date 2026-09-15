import { orderCharges } from '../tests/costs.ts';
import type { PreparedBars } from './indicators.ts';
import { positionSize, type RiskLimits } from './risk.ts';
import type { Side, Signal, Strategy, StrategyParams } from './strategies.ts';

export type ExitReason = 'stop' | 'target' | 'signal' | 'day-end' | 'loss-limit' | 'kill';

export const REASON_LABELS: Record<ExitReason, string> = {
  stop: 'Stop-loss',
  target: 'Target',
  signal: 'Strategy exit',
  'day-end': 'Closed at 15:15',
  'loss-limit': 'Daily loss limit',
  kill: 'Kill switch',
};

export type Trade = {
  symbol: string;
  date: string;
  side: Side;
  qty: number;
  entryTime: number;
  entryPrice: number;
  stop: number;
  target: number | null;
  /** Start of the bar the exit happened in: at its open, at the stop or target during it, or at its close. */
  exitTime: number;
  exitPrice: number;
  reason: ExitReason;
  gross: number;
  charges: number;
  net: number;
  /** Net result in multiples of the amount at risk when entering. */
  r: number;
};

export type OpenPosition = Omit<Trade, 'exitTime' | 'exitPrice' | 'reason' | 'gross' | 'charges' | 'net' | 'r'> & {
  entryCharges: number;
  /** Profit or loss at the latest close, before exit charges. */
  unrealized: number;
};

export type DayResult = { date: string; trades: number; net: number };

export type SimulationResult = {
  trades: Trade[];
  days: DayResult[];
  /** Only for a session still in progress. */
  open: OpenPosition | null;
  /** An entry decided at the latest close, to be filled at the next bar's open. */
  pending: Signal | null;
  halted: boolean;
};

/**
 * When the paper trader was switched on. Entries only happen inside a window; a window that ended with the kill
 * switch also exits any open position at the last close before `until`.
 */
export type ActiveWindow = { from: number; until: number | null; kill?: boolean };

export type SimulationOptions = {
  firstSession?: number;
  /** Exclusive. */
  lastSession?: number;
  windows?: ActiveWindow[];
  /** The last session may still be trading: don't force the day-end exit at its latest bar. */
  live?: boolean;
};

/**
 * Replays bars through a strategy under the risk limits. Decisions use a bar's close and fill at the next bar's open,
 * so nothing sees the future. Stops (checked before targets) fill at the stop, or at the open if the price gapped past it.
 */
export function simulate(
  data: PreparedBars,
  strategy: Strategy,
  params: StrategyParams,
  risk: RiskLimits,
  options: SimulationOptions = {},
): SimulationResult {
  const firstSession = options.firstSession ?? 0;
  const lastSession = Math.min(options.lastSession ?? data.sessions.length, data.sessions.length);
  const barMinutes = data.barSeconds / 60;
  const slip = risk.slippage;
  const trades: Trade[] = [];
  const days: DayResult[] = [];
  let open: OpenPosition | null = null;
  let pending: Signal | 'exit' | null = null;
  let halted = false;

  const allowedAt = (time: number) =>
    !options.windows || options.windows.some((w) => w.from <= time && (w.until == null || time <= w.until));

  for (let s = firstSession; s < lastSession; s++) {
    const start = data.sessionStart[s];
    const end = data.sessionStart[s + 1];
    const date = data.sessions[s].date;
    const liveSession = options.live === true && s === data.sessions.length - 1;
    let tradesToday = 0;
    let realizedToday = 0;
    let position: OpenPosition | null = null;
    pending = null;
    halted = false;

    const exit = (price: number, time: number, reason: ExitReason) => {
      const p = position!;
      const exitCharges = orderCharges(p.qty * price, p.side === 1 ? 'sell' : 'buy', 'intraday');
      const gross = p.side * (price - p.entryPrice) * p.qty;
      const charges = p.entryCharges + exitCharges;
      const net = gross - charges;
      const risked = Math.abs(p.entryPrice - p.stop) * p.qty;
      trades.push({
        symbol: p.symbol,
        date: p.date,
        side: p.side,
        qty: p.qty,
        entryTime: p.entryTime,
        entryPrice: p.entryPrice,
        stop: p.stop,
        target: p.target,
        exitTime: time,
        exitPrice: price,
        reason,
        gross,
        charges,
        net,
        r: risked > 0 ? net / risked : 0,
      });
      realizedToday += net;
      position = null;
    };

    for (let i = start; i < end; i++) {
      const [time, o, h, l, c] = data.bars[i];
      const barEnd = time + data.barSeconds;
      const lastBar = i === end - 1;

      // 1. Orders decided at the previous close fill at this open.
      if (pending === 'exit' && position) {
        exit(o * (1 - (position as OpenPosition).side * slip), time, 'signal');
      } else if (pending && pending !== 'exit' && !position) {
        const { side, stop } = pending;
        const fill = o * (1 + side * slip);
        const qty = side === 1 ? (stop < fill ? positionSize(risk, fill, stop) : 0) : stop > fill ? positionSize(risk, fill, stop) : 0;
        if (qty > 0) {
          const targetR = params.targetR ?? 0;
          position = {
            symbol: data.symbol,
            date,
            side,
            qty,
            entryTime: time,
            entryPrice: fill,
            stop,
            target: targetR > 0 ? fill + side * targetR * Math.abs(fill - stop) : null,
            entryCharges: orderCharges(qty * fill, side === 1 ? 'buy' : 'sell', 'intraday'),
            unrealized: 0,
          };
          tradesToday++;
        }
      }
      pending = null;

      // 2. Stop-loss and target inside this bar.
      if (position) {
        const p: OpenPosition = position;
        if (p.side === 1) {
          if (l <= p.stop) exit(Math.min(o, p.stop) * (1 - slip), time, 'stop');
          else if (p.target != null && h >= p.target) exit(Math.max(o, p.target), time, 'target');
        } else {
          if (h >= p.stop) exit(Math.max(o, p.stop) * (1 + slip), time, 'stop');
          else if (p.target != null && l <= p.target) exit(Math.min(o, p.target), time, 'target');
        }
      }

      // 3. At this bar's close: kill switch, day end, daily loss limit, strategy exit.
      const minuteEnd = data.minute[i] + barMinutes;
      const nextEnd = lastBar ? Infinity : data.bars[i + 1][0] + data.barSeconds;
      const killed = options.windows?.some((w) => w.kill && w.until != null && barEnd <= w.until && w.until < nextEnd) ?? false;
      if (position) {
        const p: OpenPosition = position;
        p.unrealized = p.side * (c - p.entryPrice) * p.qty;
        const closePrice = c * (1 - p.side * slip);
        if (killed) exit(closePrice, time, 'kill');
        else if (minuteEnd >= risk.squareOffMinute || (lastBar && !liveSession)) exit(closePrice, time, 'day-end');
        else if (realizedToday + p.unrealized - p.entryCharges <= -risk.dailyLossLimit * risk.capital) {
          exit(closePrice, time, 'loss-limit');
          halted = true;
        } else if (strategy.exit?.({ data, i, params, tradesToday, side: p.side })) pending = 'exit';
      }
      if (realizedToday <= -risk.dailyLossLimit * risk.capital) halted = true;

      // 4. New entry, filled at the next open.
      if (
        !position &&
        !halted &&
        (!lastBar || liveSession) &&
        tradesToday < risk.maxTradesPerDay &&
        minuteEnd <= risk.lastEntryMinute &&
        allowedAt(barEnd)
      ) {
        const signal = strategy.entry({ data, i, params, tradesToday });
        if (signal && Number.isFinite(signal.stop) && (risk.allowShort || signal.side === 1)) pending = signal;
      }
    }

    days.push({ date, trades: tradesToday, net: realizedToday });
    if (liveSession) open = position;
  }

  return { trades, days, open, pending: pending === 'exit' ? null : pending, halted };
}
