import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../types.ts';
import { longHistoryAgrees, needsLongHistory, priceSeries, rangeStart, startsLate, summarizePrices, type LongHistoryFile } from './prices.ts';

const row = (date: string, close: number, open = close): Row => [date, open, close, close, close, close, 1000];
const history = (rows: Row[]): HistoryFile => ({ symbol: 'TEST.NS', name: 'Test', updatedAt: '', lastDate: rows[rows.length - 1][0], rows });

// Weekdays from 2025-01-01 to 2026-03-13, opening at 99 and closing at 100 + trading day number.
const days: Row[] = [];
for (let d = new Date(Date.UTC(2025, 0, 1)), i = 0; d <= new Date(Date.UTC(2026, 2, 13)); d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(row(d.toISOString().slice(0, 10), 100 + i++, 99));
}
const daily = history(days);

describe('rangeStart', () => {
  const series = priceSeries(daily, null);

  it('uses the previous close for 1D', () => {
    const start = rangeStart(series, '1D');
    expect(start.date).toBe('2026-03-12');
    expect(start.partial).toBe(false);
  });

  it('uses the close on or before the date a week, month or year back', () => {
    expect(rangeStart(series, '1W').date).toBe('2026-03-06');
    expect(rangeStart(series, '1M').date).toBe('2026-02-13');
    // 2025-03-13 is a Thursday.
    expect(rangeStart(series, '1Y').date).toBe('2025-03-13');
    expect(rangeStart(series, '1Y').price).toBe(days.find((r) => r[0] === '2025-03-13')![4]);
  });

  it('falls back to the first traded price when history is shorter than the range', () => {
    expect(rangeStart(series, '5Y')).toEqual({ index: 0, date: '2025-01-01', price: 99, partial: true });
    expect(rangeStart(series, 'all')).toEqual({ index: 0, date: '2025-01-01', price: 99, partial: false });
  });
});

describe('long history', () => {
  const lastFebClose = days.filter((r) => r[0] < '2025-03-01').at(-1)![4];
  const long: LongHistoryFile = {
    symbol: 'TEST.NS',
    fetchedAt: '2026-03-13T12:00:00Z',
    bars: [
      ['2024-11-01', 40, 50],
      ['2024-12-01', 50, 60],
      ['2025-01-01', 60, 999], // same month as the first daily close, so the daily prices are used instead
      ['2025-02-01', 1, lastFebClose],
    ],
  };

  it('puts monthly closes before the daily ones, and starts All at the first monthly open', () => {
    const series = priceSeries(daily, long);
    expect(series.dates.slice(0, 3)).toEqual(['2024-11-01', '2024-12-01', '2025-01-01']);
    expect(series.closes.slice(0, 3)).toEqual([50, 60, 100]);
    expect(series.monthlyPoints).toBe(2);
    expect(rangeStart(series, 'all').price).toBe(40);
    expect(summarizePrices(daily, long).starts.all).toEqual(['2024-11-01', 40]);
  });

  it('notices when monthly prices no longer match the daily ones', () => {
    expect(longHistoryAgrees(long, daily)).toBe(true);
    const split = { ...long, bars: long.bars.map(([d, o, c]): [string, number, number] => [d, o * 2, c * 2]) };
    expect(longHistoryAgrees(split, daily)).toBe(false);
  });

  it('is only needed when daily history reaches back ten years', () => {
    expect(needsLongHistory(daily)).toBe(false);
    expect(needsLongHistory(history([row('2016-03-14', 1), row('2026-03-13', 2)]))).toBe(true);
  });
});

it('flags saved start dates later than the range', () => {
  expect(startsLate('1Y', '2025-06-01', '2026-03-13')).toBe(true);
  expect(startsLate('1Y', '2025-03-13', '2026-03-13')).toBe(false);
  expect(startsLate('all', '2025-06-01', '2026-03-13')).toBe(false);
});
