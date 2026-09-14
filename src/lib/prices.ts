import type { HistoryFile } from '../types.ts';
import { subtractDays, subtractMonths } from './dates.ts';

export type RangeKey = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'all';

export const PRICE_RANGES: { key: RangeKey; label: string; phrase: string }[] = [
  { key: '1D', label: '1D', phrase: 'on the latest trading day' },
  { key: '1W', label: '1W', phrase: 'over the past week' },
  { key: '1M', label: '1M', phrase: 'over the past month' },
  { key: '3M', label: '3M', phrase: 'over the past 3 months' },
  { key: '6M', label: '6M', phrase: 'over the past 6 months' },
  { key: '1Y', label: '1Y', phrase: 'over the past year' },
  { key: '5Y', label: '5Y', phrase: 'over the past 5 years' },
  { key: 'all', label: 'All', phrase: 'since the first price on record' },
];

/** Monthly bar: [month start, open, close]. Split-adjusted like the daily closes. */
export type LongBar = [date: string, open: number, close: number];

/** public/data/long/<id>.json: monthly prices since the first price on record, for stocks older than the daily history. */
export type LongHistoryFile = { symbol: string; fetchedAt: string; bars: LongBar[] };

/** public/data/prices.json: each stock's latest close and its price at the start of every range. */
export type PriceSummary = {
  updatedAt: string;
  stocks: {
    symbol: string;
    name: string;
    lastDate: string;
    lastClose: number;
    starts: Record<RangeKey, [date: string, price: number]>;
  }[];
};

/** Closing prices oldest first: monthly closes before the daily history begins, then daily closes. */
export type PriceSeries = {
  dates: string[];
  closes: number[];
  /** Opening price on the first date, i.e. the first traded price on record. */
  firstOpen: number;
  /** How many of the first points are monthly closes. */
  monthlyPoints: number;
};

export type RangeStart = {
  index: number;
  date: string;
  price: number;
  /** The price history is shorter than the range, so it starts at the first price. */
  partial: boolean;
};

/** Daily history from Yahoo covers ten years; if it reaches back that far, the stock probably has older prices. */
export const needsLongHistory = (history: HistoryFile) => history.rows[0][0] <= subtractMonths(history.lastDate, 119);

export function toLongHistory(monthly: HistoryFile, fetchedAt: string): LongHistoryFile {
  return { symbol: monthly.symbol, fetchedAt, bars: monthly.rows.map((row) => [row[0], row[1], row[4]]) };
}

const monthOf = (date: string) => date.slice(0, 7);

/**
 * False when the stored monthly prices no longer line up with the daily ones, usually because a split or bonus
 * since they were saved changed Yahoo's adjusted prices. Compares the latest complete month covered by both.
 */
export function longHistoryAgrees(long: LongHistoryFile, history: HistoryFile, tolerance = 0.02): boolean {
  const lastCloseInMonth = new Map<string, number>();
  for (const row of history.rows) lastCloseInMonth.set(monthOf(row[0]), row[4]);
  const firstMonth = monthOf(history.rows[0][0]);
  const fetchedMonth = monthOf(long.fetchedAt);
  for (let i = long.bars.length - 1; i >= 0; i--) {
    const [date, , close] = long.bars[i];
    const month = monthOf(date);
    if (month >= fetchedMonth || month <= firstMonth) continue;
    const daily = lastCloseInMonth.get(month);
    if (daily != null) return Math.abs(close / daily - 1) <= tolerance;
  }
  return true;
}

export function priceSeries(history: HistoryFile, long: LongHistoryFile | null): PriceSeries {
  const firstDailyMonth = monthOf(history.rows[0][0]);
  const monthly = (long?.bars ?? []).filter((bar) => monthOf(bar[0]) < firstDailyMonth && bar[2] > 0);
  const dates = [...monthly.map((bar) => bar[0]), ...history.rows.map((row) => row[0])];
  const closes = [...monthly.map((bar) => bar[2]), ...history.rows.map((row) => row[4])];
  const open = monthly.length ? monthly[0][1] : history.rows[0][1];
  return { dates, closes, firstOpen: open > 0 ? open : closes[0], monthlyPoints: monthly.length };
}

/** The calendar date a range reaches back to from the latest close; null for 1D (previous close) and all. */
export function rangeTarget(key: RangeKey, lastDate: string): string | null {
  switch (key) {
    case '1W':
      return subtractDays(lastDate, 7);
    case '1M':
      return subtractMonths(lastDate, 1);
    case '3M':
      return subtractMonths(lastDate, 3);
    case '6M':
      return subtractMonths(lastDate, 6);
    case '1Y':
      return subtractMonths(lastDate, 12);
    case '5Y':
      return subtractMonths(lastDate, 60);
    default:
      return null;
  }
}

/** The close on the last trading day on or before the range's start; the first traded price if history is shorter. */
export function rangeStart(series: PriceSeries, key: RangeKey): RangeStart {
  const last = series.dates.length - 1;
  const first = { index: 0, date: series.dates[0], price: series.firstOpen };
  if (key === 'all') return { ...first, partial: false };
  if (key === '1D') {
    return last > 0
      ? { index: last - 1, date: series.dates[last - 1], price: series.closes[last - 1], partial: false }
      : { ...first, partial: true };
  }
  const target = rangeTarget(key, series.dates[last])!;
  for (let i = last - 1; i >= 0; i--) {
    if (series.dates[i] <= target) return { index: i, date: series.dates[i], price: series.closes[i], partial: false };
  }
  return { ...first, partial: true };
}

/** True when a start date saved in prices.json is later than the range asks for. */
export function startsLate(key: RangeKey, startDate: string, lastDate: string): boolean {
  const target = rangeTarget(key, lastDate);
  return target != null && startDate > target;
}

const round2 = (value: number) => Number(value.toFixed(2));

export function summarizePrices(history: HistoryFile, long: LongHistoryFile | null): PriceSummary['stocks'][number] {
  const series = priceSeries(history, long);
  const starts = {} as Record<RangeKey, [string, number]>;
  for (const { key } of PRICE_RANGES) {
    const start = rangeStart(series, key);
    starts[key] = [start.date, round2(start.price)];
  }
  const lastRow = history.rows[history.rows.length - 1];
  return { symbol: history.symbol, name: history.name, lastDate: lastRow[0], lastClose: lastRow[4], starts };
}
