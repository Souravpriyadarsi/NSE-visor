import {
  INTERVAL_SECONDS,
  IST_OFFSET_SECONDS,
  istDate,
  istMinute,
  MARKET_CLOSE_MINUTE,
  MARKET_OPEN_MINUTE,
  type IntradayBar,
  type IntradayHistory,
  type IntradayInterval,
} from '../intraday/bars.ts';

export type AngelInterval = 'ONE_MINUTE' | 'FIVE_MINUTE';

export const ANGEL_INTERVALS: Record<IntradayInterval, AngelInterval> = { '1m': 'ONE_MINUTE', '5m': 'FIVE_MINUTE' };

/** Longest span one getCandleData request may cover, in days. */
export const MAX_DAYS_PER_REQUEST: Record<IntradayInterval, number> = { '1m': 30, '5m': 100 };

/** [time like "2026-09-15T09:15:00+05:30", open, high, low, close, volume] */
export type CandleRow = [time: string, open: number, high: number, low: number, close: number, volume: number];

/** "2026-09-15 09:15" on the exchange clock, the format getCandleData expects. */
export const angelDateTime = (unixSeconds: number) =>
  new Date((unixSeconds + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 16).replace('T', ' ');

/** Splits the last `days` days into request-sized [from, to] ranges, oldest first (a day short of the limit, to be safe). */
export function candleRanges(interval: IntradayInterval, days: number, now: Date): [from: string, to: string][] {
  const end = Math.floor(now.getTime() / 1000);
  const start = end - days * 86400;
  const span = (MAX_DAYS_PER_REQUEST[interval] - 1) * 86400;
  const ranges: [string, string][] = [];
  for (let to = end; to > start; to -= span) ranges.unshift([angelDateTime(Math.max(start, to - span)), angelDateTime(to)]);
  return ranges;
}

/** Turns candle rows into completed market-hours bars grouped by trading day, like parseIntraday does for Yahoo. */
export function candlesToHistory(symbol: string, interval: IntradayInterval, rows: CandleRow[], now = new Date()): IntradayHistory {
  const step = INTERVAL_SECONDS[interval];
  const nowSeconds = now.getTime() / 1000;
  const byTime = new Map<number, IntradayBar>();
  for (const [iso, open, high, low, close, volume] of rows) {
    const time = Math.round(Date.parse(iso) / 1000);
    if (!Number.isFinite(time) || !(close > 0) || time % step !== 0 || time + step > nowSeconds) continue;
    const minute = istMinute(time);
    if (minute < MARKET_OPEN_MINUTE || minute >= MARKET_CLOSE_MINUTE) continue;
    byTime.set(time, [time, open, high, low, close, volume]);
  }

  const byDate = new Map<string, IntradayBar[]>();
  for (const bar of [...byTime.values()].sort((a, b) => a[0] - b[0])) {
    const date = istDate(bar[0]);
    let bars = byDate.get(date);
    if (!bars) byDate.set(date, (bars = []));
    bars.push(bar);
  }
  return { symbol, interval, sessions: [...byDate].map(([date, bars]) => ({ date, bars })) };
}
