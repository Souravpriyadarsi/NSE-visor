import type { HistoryFile } from '../../types.ts';
import { fileId } from './symbols.ts';

const CACHE_NAME = 'nse-predictor-history-v1';

/** Stored copies younger than this are used without asking Yahoo again. */
export const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export function isFresh(history: HistoryFile, now = Date.now()): boolean {
  return now - Date.parse(history.updatedAt) < FRESH_FOR_MS;
}

const keyFor = (symbol: string) => `${location.origin}${import.meta.env.BASE_URL}stored-history/${fileId(symbol)}.json`;

// Uses the browser's Cache Storage: plenty of room for 10-year histories, unlike localStorage.
async function openStore(): Promise<Cache | null> {
  try {
    return 'caches' in globalThis ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

export async function readStored(symbol: string): Promise<HistoryFile | null> {
  try {
    const res = await (await openStore())?.match(keyFor(symbol));
    return res ? ((await res.json()) as HistoryFile) : null;
  } catch {
    return null;
  }
}

export async function writeStored(history: HistoryFile): Promise<void> {
  try {
    const body = new Response(JSON.stringify(history), { headers: { 'Content-Type': 'application/json' } });
    await (await openStore())?.put(keyFor(history.symbol), body);
  } catch {
    // Storage full or blocked: the data just isn't kept between visits.
  }
}

export async function deleteStored(symbol: string): Promise<void> {
  try {
    await (await openStore())?.delete(keyFor(symbol));
  } catch {
    // Nothing to clean up.
  }
}
