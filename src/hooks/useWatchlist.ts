import { useCallback } from 'react';
import { useLocalStorageState } from './useLocalStorageState.ts';

const DEFAULT_WATCHLIST = ['^NSEI', 'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS'];

const parseSymbols = (stored: unknown) =>
  Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : null;

/** Starred stocks, saved in this browser. */
export function useWatchlist() {
  const [symbols, setSymbols] = useLocalStorageState('nse-predictor:watchlist', DEFAULT_WATCHLIST, parseSymbols);

  const toggle = useCallback(
    (symbol: string) => setSymbols((current) => (current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol])),
    [setSymbols],
  );

  return { symbols, toggle };
}

export type Watchlist = ReturnType<typeof useWatchlist>;
