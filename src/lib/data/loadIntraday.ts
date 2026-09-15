import { parseIntraday, WrongIntervalError, type IntradayHistory, type IntradayInterval } from '../intraday/bars.ts';
import { LIVE_SOURCE, SymbolUnavailableError } from './loadHistory.ts';
import { displaySymbol } from './symbols.ts';

/** 1-minute prices only go back 1d or 5d (see chartQuery.ts). */
export type IntradayRange = '1d' | '5d' | '60d';

/** Intraday bars, live from Yahoo Finance through the dev server or the Cloudflare Worker. */
export async function loadIntraday(
  symbol: string,
  range: IntradayRange,
  signal?: AbortSignal,
  interval: IntradayInterval = '5m',
): Promise<IntradayHistory> {
  if (!LIVE_SOURCE) {
    throw new SymbolUnavailableError("Intraday prices come live through the Cloudflare Worker, which isn't set up on this site (see the README).");
  }
  const res = await fetch(`${LIVE_SOURCE}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`, { signal, cache: 'no-store' });
  if (res.status === 404) throw new SymbolUnavailableError(`Yahoo Finance has no data for ${displaySymbol(symbol)}.`);
  if (res.status === 400) {
    throw new Error(
      `The price relay refused an intraday price request for ${displaySymbol(symbol)}. If this is the hosted site, redeploy the Cloudflare Worker (npx wrangler deploy in the worker folder).`,
    );
  }
  if (!res.ok) throw new Error(`Couldn't fetch intraday prices for ${displaySymbol(symbol)} (HTTP ${res.status}). Trying again shortly.`);
  try {
    return parseIntraday(await res.json(), { symbol, interval });
  } catch (err) {
    if (err instanceof WrongIntervalError) {
      throw new Error('The Cloudflare Worker is an older version that only serves daily prices. Redeploy it with npx wrangler deploy in the worker folder.');
    }
    throw err;
  }
}
