import { describe, expect, it } from 'vitest';
import { chartRequest } from '../data/chartQuery.ts';
import { orderCharges } from '../tests/costs.ts';
import { parseIntraday, WrongIntervalError, type IntradayBar, type IntradayHistory } from './bars.ts';
import { walkForward } from './evaluate.ts';
import { prepareBars } from './indicators.ts';
import { DEFAULT_PAPER_STATE, paperDay } from './paper.ts';
import { DEFAULT_RISK, positionSize, type RiskLimits } from './risk.ts';
import { simulate, type ActiveWindow, type SimulationOptions } from './simulator.ts';
import { strategyById } from './strategies.ts';

const OPEN = Date.UTC(2026, 2, 2, 3, 45) / 1000; // Monday 2 March 2026, 09:15 IST
const STEP = 300;
const RISK: RiskLimits = { ...DEFAULT_RISK, slippage: 0 };
const ORB = strategyById('orb');
const ORB_PARAMS = { rangeMinutes: 15, atrStop: 0, targetR: 2 };

type OHLC = [open: number, high: number, low: number, close: number];

/** A full day of 75 five-minute bars: the given ones, then flat bars at the last close. */
function day(start: number, given: OHLC[]): IntradayBar[] {
  const bars: IntradayBar[] = given.map(([o, h, l, c], i) => [start + i * STEP, o, h, l, c, 1000]);
  const last = given[given.length - 1][3];
  for (let i = given.length; i < 75; i++) bars.push([start + i * STEP, last, last, last, last, 1000]);
  return bars;
}

const oneDay = (bars: IntradayBar[]): IntradayHistory => ({ symbol: 'TEST.NS', interval: '5m', sessions: [{ date: '2026-03-02', bars }] });
const run = (bars: IntradayBar[], risk = RISK, options: SimulationOptions = {}) => simulate(prepareBars(oneDay(bars)), ORB, ORB_PARAMS, risk, options);

// A 99.5–100.5 range from 09:15 to 09:30, a close above it at 09:30, and an entry at 09:35's open of 101.2.
const BREAKOUT: OHLC[] = [
  [100, 100.5, 99.5, 100.2],
  [100.2, 100.4, 99.8, 100],
  [100, 100.3, 99.9, 100.1],
  [100.1, 101.1, 100, 101],
  [101.2, 101.5, 101.1, 101.3],
];

describe('parseIntraday', () => {
  const response = (times: number[], closes: (number | null)[], granularity = '5m') => ({
    chart: {
      result: [
        {
          meta: { dataGranularity: granularity },
          timestamp: times,
          indicators: { quote: [{ open: closes, high: closes, low: closes, close: closes, volume: closes.map(() => 10) }] },
        },
      ],
      error: null,
    },
  });

  it('keeps only completed bars in market hours', () => {
    const times = [OPEN - 300, OPEN, OPEN + 300, OPEN + 600, OPEN + 637, OPEN + 900];
    const parsed = parseIntraday(response(times, [1, 2, null, 4, 5, 6]), {
      symbol: 'TEST.NS',
      interval: '5m',
      now: new Date((OPEN + 1000) * 1000),
    });
    // 09:10 is before the open, 09:20 has no price, 09:25:37 is Yahoo's live quote and 09:30 is still forming.
    expect(parsed.sessions).toEqual([{ date: '2026-03-02', bars: [[OPEN, 2, 2, 2, 2, 10], [OPEN + 600, 4, 4, 4, 4, 10]] }]);
  });

  it('drops the 15:30 closing auction point', () => {
    const parsed = parseIntraday(response([OPEN + 22200, OPEN + 22500], [1, 2]), { symbol: 'TEST.NS', interval: '5m', now: new Date(2e12) });
    expect(parsed.sessions[0].bars.map((b) => b[0])).toEqual([OPEN + 22200]);
  });

  it('rejects daily prices sent for an intraday request', () => {
    expect(() => parseIntraday(response([OPEN], [1], '1d'), { symbol: 'TEST.NS', interval: '5m' })).toThrow(WrongIntervalError);
  });
});

describe('chartRequest', () => {
  it('allows only known intervals and ranges', () => {
    expect(chartRequest(new URLSearchParams('symbol=TCS.NS'))).toEqual({ query: 'range=10y&interval=1d', maxAgeSeconds: 900 });
    expect(chartRequest(new URLSearchParams('interval=5m&range=60d'))?.maxAgeSeconds).toBe(30);
    expect(chartRequest(new URLSearchParams('interval=5m&range=10y'))).toBeNull();
    expect(chartRequest(new URLSearchParams('interval=constructor'))).toBeNull();
  });
});

describe('prepareBars', () => {
  it('restarts VWAP each day', () => {
    const data = prepareBars({
      symbol: 'TEST.NS',
      interval: '5m',
      sessions: [
        { date: '2026-03-02', bars: day(OPEN, BREAKOUT) },
        { date: '2026-03-03', bars: day(OPEN + 86400, [[200, 201, 199, 200]]) },
      ],
    });
    expect(data.sessionStart).toEqual([0, 75, 150]);
    expect(data.minute[75]).toBe(9 * 60 + 15);
    expect(data.vwap[75]).toBeCloseTo(200);
  });
});

describe('simulate', () => {
  it('enters at the open after the breakout bar and squares off at 15:15', () => {
    const { trades } = run(day(OPEN, BREAKOUT));
    expect(trades).toHaveLength(1);
    const [t] = trades;
    expect(t.entryTime).toBe(OPEN + 4 * STEP);
    expect(t.entryPrice).toBe(101.2);
    expect(t.stop).toBe(99.5);
    expect(t.qty).toBe(294); // ₹500 at risk ÷ ₹1.70 a share
    expect(t.target).toBeCloseTo(104.6);
    expect(t.reason).toBe('day-end');
    expect(t.exitTime).toBe(OPEN + 71 * STEP); // the 15:10–15:15 bar
    expect(t.exitPrice).toBe(101.3);
  });

  it('exits at the stop-loss', () => {
    const [t] = run(day(OPEN, [...BREAKOUT, [101.3, 101.4, 99.4, 99.6]])).trades;
    expect(t.reason).toBe('stop');
    expect(t.exitPrice).toBe(99.5);
    expect(t.exitTime).toBe(OPEN + 5 * STEP);
  });

  it('exits at the target', () => {
    const [t] = run(day(OPEN, [...BREAKOUT, [101.3, 104.8, 101.2, 104.7]])).trades;
    expect(t.reason).toBe('target');
    expect(t.exitPrice).toBeCloseTo(104.6);
  });

  it('charges Zerodha intraday rates on both orders', () => {
    const [t] = run(day(OPEN, BREAKOUT)).trades;
    expect(t.charges).toBeCloseTo(orderCharges(294 * 101.2, 'buy', 'intraday') + orderCharges(294 * 101.3, 'sell', 'intraday'), 6);
    expect(t.net).toBeCloseTo(t.gross - t.charges, 6);
  });

  it('caps the position at the capital', () => {
    const risky = { ...RISK, riskPerTrade: 0.05 };
    expect(positionSize(risky, 101.2, 99.5)).toBe(988);
    expect(run(day(OPEN, BREAKOUT), risky).trades[0].qty).toBe(988);
  });

  it('stops for the day at the daily loss limit', () => {
    const result = run(day(OPEN, [...BREAKOUT, [101.3, 101.3, 100.5, 100.6]]), { ...RISK, riskPerTrade: 0.05, dailyLossLimit: 0.005 });
    expect(result.trades[0].reason).toBe('loss-limit');
    expect(result.trades[0].exitPrice).toBe(100.6);
    expect(result.halted).toBe(true);
  });

  it("doesn't let later prices change earlier decisions", () => {
    const calm = day(OPEN, BREAKOUT);
    const crash = calm.map((bar, i): IntradayBar => (i > 4 ? [bar[0], 90, 91, 89, 90, 1000] : bar));
    const pick = (bars: IntradayBar[]) => {
      const t = run(bars).trades[0];
      return [t.entryTime, t.entryPrice, t.qty, t.stop];
    };
    expect(pick(crash)).toEqual(pick(calm));
  });

  it('trades short only when allowed', () => {
    const down: OHLC[] = [...BREAKOUT.slice(0, 3), [100.1, 100.1, 98.9, 99]];
    expect(run(day(OPEN, down)).trades[0].side).toBe(-1);
    expect(run(day(OPEN, down), { ...RISK, allowShort: false }).trades).toHaveLength(0);
  });

  it('keeps a position open in a session that is still trading', () => {
    const bars = day(OPEN, BREAKOUT).slice(0, 6);
    const live = run(bars, RISK, { live: true });
    expect(live.trades).toHaveLength(0);
    expect(live.open?.qty).toBe(294);
    expect(live.open?.unrealized).toBeCloseTo((101.3 - 101.2) * 294);
    expect(run(bars).trades[0].reason).toBe('day-end');
  });

  it('only enters while switched on, and the kill switch exits at the last close', () => {
    const later: ActiveWindow[] = [{ from: OPEN + 20 * STEP, until: null }];
    expect(run(day(OPEN, BREAKOUT), RISK, { windows: later }).trades).toHaveLength(0);

    const killed: ActiveWindow[] = [{ from: OPEN, until: OPEN + 9 * STEP + 60, kill: true }];
    const [t] = run(day(OPEN, BREAKOUT), RISK, { windows: killed }).trades;
    expect(t.reason).toBe('kill');
    expect(t.exitTime).toBe(OPEN + 8 * STEP);
  });
});

describe('walkForward', () => {
  it('needs enough days', () => {
    expect(walkForward(prepareBars(oneDay(day(OPEN, BREAKOUT))), ORB, RISK)).toBeNull();
  });

  it('chooses settings on the first two-thirds and judges on the rest', () => {
    const winner: OHLC[] = [...BREAKOUT, [101.3, 104.8, 101.2, 104.7]];
    const sessions = Array.from({ length: 50 }, (_, k) => ({ date: `2026-01-${String(k + 1).padStart(2, '0')}`, bars: day(OPEN + k * 86400, winner) }));
    const result = walkForward(prepareBars({ symbol: 'TEST.NS', interval: '5m', sessions }), ORB, RISK)!;
    expect(result.testFrom).toBe(sessions[33].date);
    expect(result.test.sessions).toBe(17);
    expect(result.test.trades).toBe(17);
    expect(result.pass).toBe(true);
  });
});

describe('paperDay', () => {
  it('replays to the same state after a page refresh', () => {
    const settings = { ...DEFAULT_PAPER_STATE.settings, symbols: ['TEST.NS'], params: { 'TEST.NS': ORB_PARAMS } };
    const windows: ActiveWindow[] = [{ from: OPEN, until: null }];
    const history = oneDay(day(OPEN, BREAKOUT).slice(0, 10));
    const first = paperDay(history, '2026-03-02', settings, windows, true)!.result;
    const restored = JSON.parse(JSON.stringify({ settings, windows })) as { settings: typeof settings; windows: ActiveWindow[] };
    expect(paperDay(history, '2026-03-02', restored.settings, restored.windows, true)!.result).toEqual(first);
    expect(first.open).not.toBeNull();
  });
});
