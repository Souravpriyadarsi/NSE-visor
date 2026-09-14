import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../../types.ts';
import { orderCharges } from './costs.ts';
import { periodStart, sameDayTest } from './sameDay.ts';

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

describe('sameDayTest', () => {
  const days: Day[] = [
    ['2026-01-01', 99, 100],
    ['2026-01-02', 102, 101],
    ['2026-01-05', 101, 104],
  ];

  it('trades a fixed number of shares every day, before charges', () => {
    const result = sameDayTest(history(days), { shares: 100, withCosts: false, from: null })!;
    expect(result.dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    expect(result.startValue).toBe(10000);
    [10000, 10100, 10400].forEach((value, i) => expect(result.stock.values[i]).toBeCloseTo(value, 6));
    // Overnight: 100 shares 100 -> 102 (+200), then 101 -> 101 (0).
    expect(result.overnight.values).toEqual([10000, 10200, 10200]);
    expect(result.overnight.trades).toBe(2);
    expect(result.overnight.wins).toBe(1);
    // Intraday: 100 shares 102 -> 101 (-100), then 101 -> 104 (+300).
    expect(result.intraday.values).toEqual([10000, 9900, 10200]);
    expect(result.intraday.totalReturn).toBeCloseTo(0.02, 10);
  });

  it('gives the same return for any share count before charges', () => {
    const result = sameDayTest(history(days), { shares: 200, withCosts: false, from: null })!;
    expect(result.overnight.final).toBe(20400);
    expect(result.intraday.totalReturn).toBeCloseTo(0.02, 10);
  });

  it('takes charges off every trade, which hurt small positions more', () => {
    const small = sameDayTest(history(days), { shares: 50, withCosts: true, from: null })!;
    const large = sameDayTest(history(days), { shares: 200, withCosts: true, from: null })!;
    expect(large.overnight.final).toBeLessThan(20400);
    expect(large.overnight.charges).toBeGreaterThan(2 * 15.34);
    expect(large.intraday.final).toBeLessThan(20400);
    expect(small.overnight.totalReturn).toBeLessThan(large.overnight.totalReturn);
  });

  it('skips placeholder days and unadjusted jumps, and starts from the chosen date', () => {
    const jumpy = sameDayTest(
      history([
        ['2026-01-01', 99, 100],
        ['2026-01-02', 100, 100, 0],
        ['2026-01-05', 150, 151],
        ['2026-01-06', 151, 152],
      ]),
      { shares: 100, withCosts: false, from: null },
    )!;
    expect(jumpy.dates).toEqual(['2026-01-01', '2026-01-05', '2026-01-06']);
    expect(jumpy.overnight.skippedDays).toBe(1);
    expect(jumpy.stock.values[1]).toBe(10000);

    expect(sameDayTest(history(days), { shares: 100, withCosts: false, from: '2026-01-02' })!.dates).toEqual(['2026-01-02', '2026-01-05']);
    expect(sameDayTest(history(days), { shares: 100, withCosts: false, from: '2026-01-05' })).toBeNull();
    expect(periodStart('1Y', '2026-09-11')).toBe('2025-09-11');
    expect(periodStart('all', '2026-09-11')).toBeNull();
  });
});
