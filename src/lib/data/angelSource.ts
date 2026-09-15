import type { DepthTick } from '../angel/stream.ts';
import type { IntradayHistory, IntradayInterval } from '../intraday/bars.ts';

/** Locally, the dev server serves Angel One data using your .env.local. The hosted site doesn't have it yet. */
export const ANGEL_SOURCE: string | null = import.meta.env.DEV
  ? `${import.meta.env.BASE_URL}api/angel`
  : import.meta.env.VITE_ANGEL_URL?.trim() || null;

export type AngelStatus = {
  configured: boolean;
  loggedIn: boolean;
  /** Login was refused; it isn't retried until the dev server restarts. */
  loginFailed: boolean;
  streaming: boolean;
  lastTickAt: number | null;
  error: string | null;
  /** Stocks whose depth is being saved. */
  recording: string[];
};

export type DepthMessage = { symbol: string; tick: DepthTick };

let shared: Promise<AngelStatus | null> | null = null;

/** Null when Angel One isn't available here (like the hosted site). `fresh` skips the copy shared across the page. */
export function loadAngelStatus(fresh = false): Promise<AngelStatus | null> {
  if (!ANGEL_SOURCE) return Promise.resolve(null);
  if (shared && !fresh) return shared;
  shared = fetch(`${ANGEL_SOURCE}/status`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<AngelStatus>) : null))
    .catch(() => null);
  return shared;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `Angel One request failed (HTTP ${res.status})`;
  } catch {
    return `Angel One request failed (HTTP ${res.status})`;
  }
}

export async function loadAngelCandles(symbol: string, interval: IntradayInterval, days: number, signal?: AbortSignal): Promise<IntradayHistory> {
  if (!ANGEL_SOURCE) throw new Error('Angel One prices are only available in the local app for now.');
  const res = await fetch(`${ANGEL_SOURCE}/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&days=${days}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as IntradayHistory;
}

export const angelStreamUrl = (symbols: string[]) =>
  ANGEL_SOURCE && symbols.length ? `${ANGEL_SOURCE}/stream?symbols=${symbols.map(encodeURIComponent).join(',')}` : null;
