import { MARKET_OPEN_MINUTE } from './bars.ts';
import type { PreparedBars } from './indicators.ts';

/** 1 = long (buy first), -1 = short (sell first, buy back the same day). */
export type Side = 1 | -1;

/** Enter at the next bar's open, with this stop-loss price. */
export type Signal = { side: Side; stop: number };

export type StrategyParams = Record<string, number>;

export type StrategyId = 'orb' | 'vwap' | 'ema';

export type StrategyContext = { data: PreparedBars; i: number; params: StrategyParams; tradesToday: number };

export type Strategy = {
  id: StrategyId;
  name: string;
  description: string;
  /** Settings tried on the training days. Every set has targetR: the profit target in multiples of the risk (0 = none). */
  grid: StrategyParams[];
  describe: (params: StrategyParams) => string;
  /** Called at a bar's close when there's no open position. */
  entry: (ctx: StrategyContext) => Signal | null;
  /** Called at a bar's close with an open position; true exits at the next open. Stops, targets and the day's end are the simulator's job. */
  exit?: (ctx: StrategyContext & { side: Side }) => boolean;
};

/** Every combination of the given values. */
function grid(options: Record<string, number[]>): StrategyParams[] {
  return Object.entries(options).reduce<StrategyParams[]>(
    (sets, [key, values]) => sets.flatMap((set) => values.map((value) => ({ ...set, [key]: value }))),
    [{}],
  );
}

/** Indicators need a little of the day to settle before these strategies trade. */
const SETTLE_MINUTES = 30;

const orb: Strategy = {
  id: 'orb',
  name: 'Opening-range breakout',
  description: "Marks the high and low of the first 15 or 30 minutes, then trades the day's first close beyond them.",
  grid: grid({ rangeMinutes: [15, 30], atrStop: [0, 1], targetR: [1.5, 2] }),
  describe: (p) => `${p.rangeMinutes}-min range, stop ${p.atrStop ? `${p.atrStop}× ATR` : 'at the other side'}, target ${p.targetR}R`,
  entry({ data, i, params, tradesToday }) {
    if (tradesToday > 0) return null;
    const rangeEnd = MARKET_OPEN_MINUTE + params.rangeMinutes;
    if (data.minute[i] < rangeEnd) return null;

    const first = data.sessionStart[data.session[i]];
    let high = -Infinity;
    let low = Infinity;
    let k = first;
    for (; k < i && data.minute[k] < rangeEnd; k++) {
      high = Math.max(high, data.bars[k][2]);
      low = Math.min(low, data.bars[k][3]);
    }
    // Missing bars (a data gap) make the range unreliable.
    if ((k - first) * (data.barSeconds / 60) < params.rangeMinutes) return null;
    // Only the first close outside the range counts.
    for (let j = k; j < i; j++) if (data.close[j] > high || data.close[j] < low) return null;

    const close = data.close[i];
    const atr = data.atr[i];
    if (params.atrStop && atr == null) return null;
    if (close > high) return { side: 1, stop: params.atrStop ? close - params.atrStop * atr! : low };
    if (close < low) return { side: -1, stop: params.atrStop ? close + params.atrStop * atr! : high };
    return null;
  },
};

const vwap: Strategy = {
  id: 'vwap',
  name: 'VWAP pullback',
  description: "Follows the day's trend: when the price dips back to the volume-weighted average price and bounces, trade in the trend's direction.",
  grid: grid({ atrStop: [1, 1.5], targetR: [1.5, 2] }),
  describe: (p) => `stop ${p.atrStop}× ATR, target ${p.targetR}R`,
  entry({ data, i, params }) {
    if (data.minute[i] < MARKET_OPEN_MINUTE + SETTLE_MINUTES) return null;
    const trend = data.ema(20);
    const atr = data.atr[i];
    const now = trend[i];
    const before = trend[i - 3];
    if (atr == null || now == null || before == null) return null;
    const [, open, high, low, close] = data.bars[i];
    const average = data.vwap[i];
    if (now > before && close > average && low <= average && close > open) return { side: 1, stop: close - params.atrStop * atr };
    if (now < before && close < average && high >= average && close < open) return { side: -1, stop: close + params.atrStop * atr };
    return null;
  },
};

const emaCross: Strategy = {
  id: 'ema',
  name: 'Moving-average crossover',
  description: 'Buys when the 9-bar average crosses above the 21-bar average and sells short on the opposite cross; exits when they cross back.',
  grid: grid({ atrStop: [1, 1.5], targetR: [0, 2] }),
  describe: (p) => `stop ${p.atrStop}× ATR, ${p.targetR ? `target ${p.targetR}R` : 'no target'}`,
  entry({ data, i, params }) {
    if (data.minute[i] < MARKET_OPEN_MINUTE + SETTLE_MINUTES) return null;
    const fast = data.ema(9);
    const slow = data.ema(21);
    const atr = data.atr[i];
    const [f0, s0, f1, s1] = [fast[i - 1], slow[i - 1], fast[i], slow[i]];
    if (atr == null || f0 == null || s0 == null || f1 == null || s1 == null) return null;
    if (f0 <= s0 && f1 > s1) return { side: 1, stop: data.close[i] - params.atrStop * atr };
    if (f0 >= s0 && f1 < s1) return { side: -1, stop: data.close[i] + params.atrStop * atr };
    return null;
  },
  exit({ data, i, side }) {
    const fast = data.ema(9)[i];
    const slow = data.ema(21)[i];
    if (fast == null || slow == null) return false;
    return side === 1 ? fast < slow : fast > slow;
  },
};

export const STRATEGIES: Strategy[] = [orb, vwap, emaCross];

export const strategyById = (id: StrategyId) => STRATEGIES.find((s) => s.id === id)!;

export const STRATEGY_SHORT_NAMES: Record<StrategyId, string> = { orb: 'Opening range', vwap: 'VWAP pullback', ema: 'MA crossover' };
