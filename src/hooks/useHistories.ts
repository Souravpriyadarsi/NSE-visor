import { useEffect, useState } from 'react';
import { loadHistory } from '../lib/data/loadHistory.ts';
import type { HistoryFile } from '../types.ts';

export type LoadedHistory = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; history: HistoryFile };

const PARALLEL_LOADS = 3;

/** Loads several stocks' price histories, a few at a time. */
export function useHistories(symbols: string[]): Record<string, LoadedHistory> {
  const [loaded, setLoaded] = useState<Record<string, LoadedHistory>>({});
  const key = symbols.join(',');

  useEffect(() => {
    const controller = new AbortController();
    const queue = key ? key.split(',') : [];

    async function loadNext() {
      for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
        let entry: LoadedHistory;
        try {
          entry = { status: 'ready', history: await loadHistory(symbol, { signal: controller.signal }) };
        } catch (err) {
          entry = { status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
        if (controller.signal.aborted) return;
        setLoaded((current) => ({ ...current, [symbol]: entry }));
      }
    }

    for (let i = 0; i < PARALLEL_LOADS; i++) void loadNext();
    return () => controller.abort();
  }, [key]);

  return Object.fromEntries(symbols.map((symbol) => [symbol, loaded[symbol] ?? { status: 'loading' }]));
}
