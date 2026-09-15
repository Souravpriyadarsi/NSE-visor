/** One intraday bar: [start time (unix seconds), open, high, low, close, volume]. */
export type IntradayBar = [time: number, open: number, high: number, low: number, close: number, volume: number];

export type IntradaySession = { date: string; bars: IntradayBar[] };

export type IntradayInterval = '5m' | '1m';

export type IntradayHistory = { symbol: string; interval: IntradayInterval; sessions: IntradaySession[] };

export const INTERVAL_SECONDS: Record<IntradayInterval, number> = { '5m': 300, '1m': 60 };

export const MARKET_OPEN_MINUTE = 9 * 60 + 15;
export const MARKET_CLOSE_MINUTE = 15 * 60 + 30;
/** India has no daylight saving, so exchange time is always UTC+5:30. */
export const IST_OFFSET_SECONDS = 5.5 * 3600;

/** Minutes since midnight on the exchange clock. */
export const istMinute = (time: number) => Math.floor((((time + IST_OFFSET_SECONDS) % 86400) + 86400) % 86400 / 60);
export const istDate = (time: number) => new Date((time + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
/** "09:35" */
export const istTime = (time: number) => new Date((time + IST_OFFSET_SECONDS) * 1000).toISOString().slice(11, 16);

/** True on weekdays between 09:15 and 15:30 IST. NSE holidays aren't known here. */
export function isMarketOpen(now: Date): boolean {
  const seconds = now.getTime() / 1000;
  const weekday = new Date((seconds + IST_OFFSET_SECONDS) * 1000).getUTCDay();
  const minute = istMinute(seconds);
  return weekday !== 0 && weekday !== 6 && minute >= MARKET_OPEN_MINUTE && minute < MARKET_CLOSE_MINUTE;
}

/** Every session except today's while it's still trading, for backtests. */
export function completedSessions(history: IntradayHistory): IntradaySession[] {
  const { sessions } = history;
  const last = sessions[sessions.length - 1];
  if (!last) return sessions;
  const lastBarEnd = istMinute(last.bars[last.bars.length - 1][0]) + INTERVAL_SECONDS[history.interval] / 60;
  return lastBarEnd >= MARKET_CLOSE_MINUTE ? sessions : sessions.slice(0, -1);
}

type Nullable = (number | null)[];

type YahooIntradayResponse = {
  chart?: {
    result?: Array<{
      meta?: { dataGranularity?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Nullable; high?: Nullable; low?: Nullable; close?: Nullable; volume?: Nullable }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

/** Yahoo sent daily prices for an intraday request: the Cloudflare Worker is an older version. */
export class WrongIntervalError extends Error {}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Turns Yahoo's intraday chart response into completed market-hours bars grouped by trading day.
 * Drops Yahoo's live quote (an extra point off the bar grid) and the bar that is still forming.
 */
export function parseIntraday(json: unknown, options: { symbol: string; interval: IntradayInterval; now?: Date }): IntradayHistory {
  const { symbol, interval } = options;
  const chart = (json as YahooIntradayResponse | null)?.chart;
  if (chart?.error) throw new Error(`Yahoo error for ${symbol}: ${chart.error.description ?? chart.error.code}`);
  const result = chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result || !quote) throw new Error(`Unexpected Yahoo response for ${symbol}`);
  const granularity = result.meta?.dataGranularity;
  if (granularity && granularity !== interval) throw new WrongIntervalError(`Got ${granularity} prices instead of ${interval} for ${symbol}`);

  const step = INTERVAL_SECONDS[interval];
  const now = (options.now ?? new Date()).getTime() / 1000;
  const byDate = new Map<string, IntradayBar[]>();
  const timestamps = result.timestamp ?? [];

  for (let i = 0; i < timestamps.length; i++) {
    const time = timestamps[i];
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (open == null || high == null || low == null || close == null || close <= 0) continue;
    if (time % step !== 0 || time + step > now) continue;
    const minute = istMinute(time);
    if (minute < MARKET_OPEN_MINUTE || minute >= MARKET_CLOSE_MINUTE) continue;
    const date = istDate(time);
    let bars = byDate.get(date);
    if (!bars) byDate.set(date, (bars = []));
    bars.push([time, round2(open), round2(high), round2(low), round2(close), Math.round(quote.volume?.[i] ?? 0)]);
  }

  const sessions = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, bars]) => ({ date, bars: bars.sort((a, b) => a[0] - b[0]) }));
  return { symbol, interval, sessions };
}
