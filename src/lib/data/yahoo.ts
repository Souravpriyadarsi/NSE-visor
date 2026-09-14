import type { HistoryFile, Row } from '../../types.ts';
import { exchangeClock, toExchangeDate } from '../dates.ts';

type Nullable = (number | null)[];

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { exchangeTimezoneName?: string; longName?: string; shortName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ open?: Nullable; high?: Nullable; low?: Nullable; close?: Nullable; volume?: Nullable }>;
        adjclose?: Array<{ adjclose?: Nullable }>;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

export type ParseOptions = { symbol: string; name?: string; now?: Date };

const MARKET_CLOSE_MINUTES = 15 * 60 + 30;
/** One-day moves bigger than this are almost always splits, bonuses or demergers Yahoo hasn't adjusted. */
export const SUSPICIOUS_LOG_MOVE = 0.3;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Turns Yahoo's /v8/finance/chart response into clean, sorted daily rows. */
export function parseChart(json: unknown, options: ParseOptions): HistoryFile {
  const { symbol } = options;
  const chart = (json as YahooChartResponse | null)?.chart;
  if (chart?.error) throw new Error(`Yahoo error for ${symbol}: ${chart.error.description ?? chart.error.code}`);

  const result = chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!result || !timestamps || !quote?.open || !quote.high || !quote.low || !quote.close) {
    throw new Error(`Unexpected Yahoo response for ${symbol}`);
  }
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose;
  const timeZone = result.meta?.exchangeTimezoneName ?? 'Asia/Kolkata';

  const byDate = new Map<string, Row>();
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];
    if (open == null || high == null || low == null || close == null || close <= 0) continue;
    const date = toExchangeDate(timestamps[i], timeZone);
    byDate.set(date, [
      date,
      round(open, 2),
      round(high, 2),
      round(low, 2),
      round(close, 2),
      round(adjClose?.[i] ?? close, 4),
      Math.round(quote.volume?.[i] ?? 0),
    ]);
  }

  const rows = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const now = options.now ?? new Date();
  const clock = exchangeClock(now, timeZone);
  if (rows.length > 0 && rows[rows.length - 1][0] === clock.date && clock.minutes < MARKET_CLOSE_MINUTES) {
    rows.pop();
  }
  if (rows.length === 0) throw new Error(`No price data for ${symbol}`);

  for (let i = 1; i < rows.length; i++) {
    const move = Math.log(rows[i][4] / rows[i - 1][4]);
    if (Math.abs(move) > SUSPICIOUS_LOG_MOVE) {
      console.warn(`${symbol}: ${(move * 100).toFixed(0)}% log move on ${rows[i][0]}, possibly an unadjusted split or bonus`);
    }
  }

  return {
    symbol,
    name: options.name ?? result.meta?.longName ?? result.meta?.shortName ?? symbol,
    updatedAt: now.toISOString(),
    lastDate: rows[rows.length - 1][0],
    rows,
  };
}
