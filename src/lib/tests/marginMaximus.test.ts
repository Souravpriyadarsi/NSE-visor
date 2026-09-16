import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../../types.ts';
import type { IntradayBar, IntradayHistory } from '../intraday/bars.ts';
import { CHARGES, orderCharges } from './costs.ts';
import {
  accountOf,
  armingPrice,
  dailySessions,
  marginMaximus,
  marginMaximusIntraday,
  marginMaximusTest,
  planTrades,
  stepBar,
  trailRule,
  type MmBar,
} from './marginMaximus.ts';

type Day = [date: string, open: number, high: number, low: number, close: number, volume?: number];

const history = (days: Day[]): HistoryFile => ({
  symbol: 'T.NS',
  name: 'Test',
  updatedAt: '',
  lastDate: days[days.length - 1][0],
  rows: days.map(([date, open, high, low, close, volume = 1000]): Row => [date, open, high, low, close, close, volume]),
});

/** A day where the price never moves, so it can only buy. */
const flat = (date: string, price: number): Day => [date, price, price, price, price];

const rules = { trigger: 2, trail: 1 };
const bar = (open: number, high: number, low: number, close: number): MmBar => ({ open, high, low, close });
const options = { shares: 100, withCosts: false, trail: '2' as const };

describe('armingPrice', () => {
  it('arms at the trigger, or at the open when the price gaps over it', () => {
    expect(armingPrice(bar(100, 103, 99, 102), 100, 2)).toBe(102);
    expect(armingPrice(bar(105, 106, 104, 105), 100, 2)).toBe(105);
    expect(armingPrice(bar(100, 101.9, 99, 101), 100, 2)).toBeNull();
  });
});

describe('stepBar', () => {
  it('does nothing on a bar that never reaches the trigger', () => {
    expect(stepBar(bar(100, 101, 98, 99), 100, null, rules, false)).toEqual({ trail: null, exit: null });
    expect(stepBar(bar(100, 101, 98, 99), 100, null, rules, true)).toEqual({ trail: null, exit: null });
  });

  it('holds on when the price arms and never falls back by the trail', () => {
    // Rises 100 -> 120 and closes at 119, one rupee below the high: the stop is still alive at the close.
    const best = stepBar(bar(100, 120, 100, 119), 100, null, rules, false);
    expect(best).toEqual({ trail: 120, exit: null });
    // The worst order still counts a fall of a rupee somewhere inside the bar, so it sells at the armed level.
    expect(stepBar(bar(100, 120, 100, 119), 100, null, rules, true)).toEqual({ trail: 120, exit: 101 });
    // A bar too narrow for any fall of a rupee can't stop out either way.
    expect(stepBar(bar(102, 102.5, 102, 102.4), 100, null, rules, true)).toEqual({ trail: 102.5, exit: null });
  });

  it('sells when the close is more than the trail below the high, whichever order the bar ran in', () => {
    const best = stepBar(bar(100, 120, 100, 110), 100, null, rules, false);
    expect(best.exit).toBe(119);
    const worst = stepBar(bar(100, 120, 100, 110), 100, null, rules, true);
    expect(worst.exit).toBe(101);
    expect(best.exit!).toBeGreaterThanOrEqual(worst.exit!);
  });

  it('sells at the open when a stop armed earlier opens below it', () => {
    expect(stepBar(bar(95, 96, 94, 95), 100, 120, rules, false)).toEqual({ trail: 120, exit: 95 });
    expect(stepBar(bar(95, 96, 94, 95), 100, 120, rules, true)).toEqual({ trail: 120, exit: 95 });
  });

  it('never makes the worst case better than the best case', () => {
    for (const open of [98, 100, 104]) {
      for (const high of [104, 110]) {
        for (const low of [90, 99]) {
          for (const close of [95, 103, 109]) {
            const shape = bar(open, Math.max(high, open, close), Math.min(low, open, close), close);
            const best = stepBar(shape, 100, null, rules, false);
            const worst = stepBar(shape, 100, null, rules, true);
            if (worst.exit != null && best.exit != null) expect(best.exit).toBeGreaterThanOrEqual(worst.exit);
            // The best order can only ever sell higher than the close, which is what the worst order falls back to.
            if (worst.exit != null && best.exit == null) expect(shape.close).toBeGreaterThanOrEqual(worst.exit);
          }
        }
      }
    }
  });
});

describe('marginMaximusTest', () => {
  it('keeps buying and never sells while the price only falls', () => {
    const falling = history([flat('2026-01-01', 100), flat('2026-01-02', 99), flat('2026-01-05', 98), flat('2026-01-06', 97)]);
    const result = marginMaximusTest(falling, { ...options, from: null })!;
    for (const run of [result.best, result.worst]) {
      expect(run.sells).toBe(0);
      expect(run.openLots).toBe(4);
      expect(run.openShares).toBe(400);
      expect(run.peakCapital).toBe(100 * (100 + 99 + 98 + 97));
      expect(run.unrealized).toBeCloseTo(100 * (4 * 97 - (100 + 99 + 98 + 97)), 6);
    }
    expect(result.holding[3]).toBe(100 * (97 - 100));
  });

  it('sells every share once the average buy price plus the trigger is reached', () => {
    // Buys at 100 and at 90 (average 95), then a day that rises to 120 and closes at 119.
    const days: Day[] = [flat('2026-01-01', 100), flat('2026-01-02', 90), ['2026-01-05', 95, 120, 95, 119]];
    const result = marginMaximusTest(history(days), { ...options, from: null })!;

    // Best order: the high comes first and the close is only a rupee below it, so both lots sell at the close.
    expect(result.best.sells).toBe(2);
    expect(result.best.wins).toBe(2);
    expect(result.best.values[2]).toBeCloseTo(100 * (119 - 100 + (119 - 90)), 6);
    // Worst order: the stop arms at the average plus the trigger (97) and sells a rupee lower.
    expect(result.worst.sells).toBe(2);
    expect(result.worst.values[2]).toBeCloseTo(100 * (96 - 100 + (96 - 90)), 6);
    // One lot is bought back at the close of the selling day.
    expect(result.best.openLots).toBe(1);
    expect(result.best.avgHoldDays).toBeCloseTo(1.5, 10);
    expect(result.best.maxShares).toBe(200);
  });

  it('sells only the lots that reach their own trigger', () => {
    // The average (95) needs 97 and the day only reaches 93.5, but the lot bought at 90 needs 92.
    const days: Day[] = [flat('2026-01-01', 100), flat('2026-01-02', 90), ['2026-01-05', 91, 93.5, 91, 93]];
    const result = marginMaximusTest(history(days), { ...options, from: null })!;
    expect(result.best.sells).toBe(1);
    expect(result.best.values[2]).toBeCloseTo(100 * (93 - 90) + 100 * (2 * 93 - (100 + 93)), 6);
    expect(result.best.openLots).toBe(2); // the lot bought at 100 and the new one at 93
    expect(result.worst.sells).toBe(1);
    expect(result.worst.values[2]).toBeCloseTo(100 * (91 - 90) + 100 * (2 * 93 - (100 + 93)), 6);
  });

  it('charges delivery rates on every order, with one DP charge per selling day', () => {
    const days: Day[] = [flat('2026-01-01', 100), flat('2026-01-02', 90), ['2026-01-05', 95, 120, 95, 119]];
    const result = marginMaximusTest(history(days), { ...options, withCosts: true, from: null })!;
    const buys = [100, 90, 119].reduce((total, price) => total + orderCharges(100 * price, 'buy', 'delivery'), 0);
    const sells = 2 * orderCharges(100 * 119, 'sell', 'delivery') - CHARGES.dpChargePerSell;
    expect(result.best.charges).toBeCloseTo(buys + sells, 6);
    expect(result.best.profit).toBeCloseTo(100 * (119 - 100 + (119 - 90)) - result.best.charges, 6);
  });

  it('skips holiday rows and unadjusted jumps, and starts at the chosen date', () => {
    const jumpy = history([
      flat('2026-01-01', 100),
      ['2026-01-02', 100, 100, 100, 100, 0], // a holiday placeholder row with no volume
      flat('2026-01-05', 150), // a 50% jump: an unadjusted split
      flat('2026-01-06', 151),
    ]);
    const { sessions, skippedDays } = dailySessions(jumpy, null);
    expect(sessions.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-06']);
    expect(skippedDays).toBe(1);

    const days: Day[] = [flat('2026-01-01', 100), flat('2026-01-02', 99), flat('2026-01-05', 98)];
    expect(marginMaximusTest(history(days), { ...options, from: '2026-01-02' })!.dates).toEqual(['2026-01-02', '2026-01-05']);
    expect(marginMaximusTest(history(days), { ...options, from: '2026-01-05' })).toBeNull();
  });

  it('never lets the worst case beat the best case', () => {
    const days: Day[] = [];
    let price = 250;
    for (let i = 0; i < 400; i++) {
      // A repeatable zig-zag: some days trend, some reverse, so lots both pile up and sell.
      price = Math.max(20, price * (1 + 0.02 * Math.sin(i / 3) + 0.01 * Math.cos(i / 7)));
      const date = `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
      const open = price * (1 + 0.003 * Math.cos(i));
      const close = price * (1 - 0.002 * Math.sin(i));
      days.push([date, open, Math.max(open, close) * 1.004, Math.min(open, close) * 0.996, close]);
    }
    const sessions = days.map(([date, open, high, low, close]) => ({ date, bars: [{ open, high, low, close }] }));
    for (const trail of ['1', '2', '5', '10'] as const) {
      for (const withCosts of [false, true]) {
        const result = marginMaximus(sessions, { shares: 100, withCosts, trail })!;
        expect(result.best.profit).toBeGreaterThanOrEqual(result.worst.profit);
        result.best.values.forEach((value, i) => expect(value).toBeGreaterThanOrEqual(result.worst.values[i] - 1e-9));
        expect(result.best.peakCapital).toBeGreaterThan(0);
        expect(result.worst.sells).toBeGreaterThan(0);
      }
    }
  });

  it('counts the money the same way for any share count before charges', () => {
    const days: Day[] = [flat('2026-01-01', 100), flat('2026-01-02', 90), ['2026-01-05', 95, 120, 95, 119]];
    const plan = planTrades(dailySessions(history(days), null).sessions, trailRule('2'), false);
    const small = accountOf(plan, { shares: 50, withCosts: false });
    const large = accountOf(plan, { shares: 200, withCosts: false });
    expect(large.profit).toBeCloseTo(4 * small.profit, 6);
    // Charges are flatter than the position, so they eat more of a small one.
    const net = (shares: number) => accountOf(plan, { shares, withCosts: true }).profit / shares;
    expect(net(50)).toBeLessThan(net(200));
  });
});

describe('marginMaximusIntraday', () => {
  const at = (date: string, minutes: number) => Date.parse(`${date}T00:00:00Z`) / 1000 + minutes * 60 - 5.5 * 3600;
  const session = (date: string, bars: [minutes: number, open: number, high: number, low: number, close: number][]): IntradayBar[] =>
    bars.map(([minutes, open, high, low, close]): IntradayBar => [at(date, minutes), open, high, low, close, 1000]);

  it('runs the same rules bar by bar, keeping a stop armed between bars', () => {
    const intraday: IntradayHistory = {
      symbol: 'T.NS',
      interval: '5m',
      sessions: [
        { date: '2026-01-01', bars: session('2026-01-01', [[9 * 60 + 15, 100, 100, 100, 100], [15 * 60 + 25, 100, 100, 100, 100]]) },
        {
          date: '2026-01-02',
          bars: session('2026-01-02', [
            [9 * 60 + 15, 100, 101, 100, 100.9], // below the trigger: nothing happens
            [9 * 60 + 20, 101.4, 102.2, 101.3, 102.1], // arms at 102 and is too narrow to be stopped either way
            [15 * 60 + 25, 102.1, 102.4, 102, 102.3], // still armed at the close: sold there
          ]),
        },
      ],
    };
    const result = marginMaximusIntraday(intraday, options)!;
    expect(result.dates).toEqual(['2026-01-01', '2026-01-02']);
    expect(result.best.sells).toBe(1);
    expect(result.worst.sells).toBe(1);
    expect(result.best.profit).toBeCloseTo(100 * (102.3 - 100), 6);
    expect(result.worst.profit).toBeCloseTo(100 * (102.3 - 100), 6);
    // 5-minute bars beat one daily bar: the same day leaves a wide range when all it says is the high and the low.
    const daily = marginMaximus(
      [
        { date: '2026-01-01', bars: [{ open: 100, high: 100, low: 100, close: 100 }] },
        { date: '2026-01-02', bars: [{ open: 100, high: 102.4, low: 100, close: 102.3 }] },
      ],
      options,
    )!;
    expect(daily.worst.profit).toBeCloseTo(100 * (101 - 100), 6);
    expect(result.best.profit - result.worst.profit).toBeLessThan(daily.best.profit - daily.worst.profit);
  });
});
