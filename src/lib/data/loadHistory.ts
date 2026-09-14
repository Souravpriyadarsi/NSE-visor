import symbolList from '../../../symbols.json' with { type: 'json' };
import type { HistoryFile, SymbolInfo } from '../../types.ts';
import { deleteStored, isFresh, readStored, writeStored } from './browserStore.ts';
import { displaySymbol, fileId } from './symbols.ts';
import { parseChart } from './yahoo.ts';

export class SymbolUnavailableError extends Error {}

/** Stocks the daily GitHub Action pre-fetches for the hosted site. */
export const BUILT_IN_STOCKS: SymbolInfo[] = symbolList;
const builtInNames = new Map(symbolList.map((s) => [s.symbol, s.name]));
export const isBuiltIn = (symbol: string) => builtInNames.has(symbol);

/** Where live Yahoo data comes from: the Vite dev server locally, the Cloudflare Worker when hosted. */
export const LIVE_SOURCE: string | null = import.meta.env.DEV
  ? `${import.meta.env.BASE_URL}api/chart`
  : import.meta.env.VITE_YAHOO_PROXY_URL?.trim() || null;

const memory = new Map<string, HistoryFile>();

type LoadOptions = { signal?: AbortSignal; refresh?: boolean };

/**
 * Hosted: built-in stocks come from the JSON files built by the GitHub Action.
 * Everything else (and everything in dev) comes live from Yahoo and is kept in the browser.
 * `refresh` skips every cache and fetches live.
 */
export async function loadHistory(symbol: string, { signal, refresh = false }: LoadOptions = {}): Promise<HistoryFile> {
  const cached = refresh ? undefined : memory.get(symbol);
  if (cached) return cached;

  // Built-in and daily-tracked stocks have static files when hosted; for anything else this is a quick 404.
  const bundled = !import.meta.env.DEV && !refresh ? await loadBundled(symbol, signal) : null;
  const history = bundled ?? (await loadLive(symbol, signal, refresh));
  memory.set(symbol, history);
  return history;
}

/** Drops a stock from the in-memory and browser caches. */
export async function forgetHistory(symbol: string): Promise<void> {
  memory.delete(symbol);
  await deleteStored(symbol);
}

async function loadBundled(symbol: string, signal?: AbortSignal): Promise<HistoryFile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${fileId(symbol)}.json`, { signal, cache: 'no-cache' });
  const isJson = res.headers.get('content-type')?.includes('json') ?? false;
  return res.ok && isJson ? ((await res.json()) as HistoryFile) : null;
}

async function loadLive(symbol: string, signal: AbortSignal | undefined, refresh: boolean): Promise<HistoryFile> {
  const stored = await readStored(symbol);
  if (stored && !refresh && isFresh(stored)) return stored;

  if (!LIVE_SOURCE) {
    if (stored && !refresh) return stored;
    throw new SymbolUnavailableError(
      `${displaySymbol(symbol)} isn't a built-in stock, and live fetching isn't set up on this site yet (see the README).`,
    );
  }

  try {
    const res = await fetch(`${LIVE_SOURCE}?symbol=${encodeURIComponent(symbol)}`, { signal });
    if (res.status === 404) {
      throw new SymbolUnavailableError(
        `Yahoo Finance has no data for ${displaySymbol(symbol)}. Check the NSE ticker (the short code shown on nseindia.com).`,
      );
    }
    if (!res.ok) throw new Error(`Couldn't fetch ${displaySymbol(symbol)} (HTTP ${res.status}). Try again in a minute.`);

    const history = parseChart(await res.json(), { symbol, name: builtInNames.get(symbol) });
    await writeStored(history);
    return history;
  } catch (err) {
    // On a network hiccup an older copy beats an error, unless the user asked for fresh data.
    if (stored && !refresh && !signal?.aborted && !(err instanceof SymbolUnavailableError)) return stored;
    throw err;
  }
}
