import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../../types.ts';
import { affordableShares, orderCharges } from './costs.ts';
import { sameDayTest } from './sameDay.ts';

type Day = [date: string, open: number, close: number, volume?: number];

const history = (days: Day[]): HistoryFile => ({
  symbol: 'T.NS',
  name: 'Test',
  updatedAt: '',
  lastDate: days[days.length - 1][0],
  rows: days.map(([date, open, close, volume = 1000]): Row => [date, open, Math.max(open, close), Math.min(open, close), close, close, volume]),
});

describe('orderCharges', () => {
  it('applies intraday and delivery rates', () => {
    expect(orderCharges(10000, 'buy', 'intraday')).toBeCloseTo(3 + 0.307 + 0.01 + 0.3 + 3.317 * 0.18, 6);
    expect(orderCharges(10000, 'sell', 'intraday')).toBeCloseTo(3 + 2.5 + 0.307 + 0.01 + 3.317 * 0.18, 6);
    expect(orderCharges(10000, 'buy', 'delivery')).toBeCloseTo(10 + 0.307 + 0.01 + 1.5 + 0.317 * 0.18, 6);
    expect(orderCharges(10000, 'sell', 'delivery')).toBeCloseTo(10 + 0.307 + 0.01 + 0.317 * 0.18 + 15.34, 6);
  });

  it('caps intraday brokerage at ₹20 per order', () => {
    expect(orderCharges(1e7, 'buy', 'intraday')).toBeCloseTo(20 + 307 + 10 + 300 + 337 * 0.18, 6);
  });
});

describe('affordableShares', () => {
  it('buys the most whole shares that fit with charges', () => {
    expect(affordableShares(10000, 100, () => 0)).toBe(100);
    expect(affordableShares(10000, 100, (v) => orderCharges(v, 'buy', 'delivery'))).toBe(99);
    expect(affordableShares(5000, 12000, () => 0)).toBe(0);
    expect(affordableShares(1_000_000, 1, (v) => v * 0.01)).toBe(Math.floor(1_000_000 / 1.01));
  });
});

describe('sameDayTest', () => {
  const days: Day[] = [
    ['2026-01-01', 99, 100],
    ['2026-01-02', 102, 101],
    ['2026-01-05', 101, 104],
  ];

  it('compares overnight and intraday trading with holding, before charges', () => {
    const result = sameDayTest(history(days), { amount: 10000, withCosts: false, days: Infinity })!;
    expect(result.dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    [10000, 10100, 10400].forEach((value, i) => expect(result.stock.values[i]).toBeCloseTo(value, 6));
    // Overnight: 100 shares bought at 100, sold at 102; then 100 shares at 101, sold at 101.
    expect(result.overnight.values).toEqual([10000, 10200, 10200]);
    expect(result.overnight.trades).toBe(2);
    expect(result.overnight.wins).toBe(1);
    // Intraday: 98 shares 102 -> 101; then 98 shares 101 -> 104.
    expect(result.intraday.values).toEqual([10000, 9902, 10196]);
    expect(result.intraday.totalReturn).toBeCloseTo(0.0196, 10);
  });

  it('takes charges off every trade', () => {
    const result = sameDayTest(history(days), { amount: 10000, withCosts: true, days: Infinity })!;
    expect(result.overnight.final).toBeLessThan(10200);
    expect(result.overnight.charges).toBeGreaterThan(2 * 15.34);
    expect(result.intraday.final).toBeLessThan(10196);
  });

  it('skips placeholder days, unadjusted jumps and unaffordable trades, and limits the period', () => {
    const jumpy = sameDayTest(
      history([
        ['2026-01-01', 99, 100],
        ['2026-01-02', 100, 100, 0],
        ['2026-01-05', 150, 151],
        ['2026-01-06', 151, 152],
      ]),
      { amount: 10000, withCosts: false, days: Infinity },
    )!;
    expect(jumpy.dates).toEqual(['2026-01-01', '2026-01-05', '2026-01-06']);
    expect(jumpy.overnight.skippedDays).toBe(1);
    expect(jumpy.stock.values[1]).toBe(10000);

    const small = sameDayTest(history(days), { amount: 50, withCosts: false, days: Infinity })!;
    expect(small.intraday.trades).toBe(0);
    expect(small.intraday.unaffordableDays).toBe(2);
    expect(small.intraday.final).toBe(50);

    expect(sameDayTest(history(days), { amount: 10000, withCosts: false, days: 1 })!.dates).toEqual(['2026-01-02', '2026-01-05']);
  });
});
