import { useCallback } from 'react';
import type { SymbolInfo } from '../types.ts';
import { useLocalStorageState } from './useLocalStorageState.ts';

const isStock = (value: unknown): value is SymbolInfo =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SymbolInfo).symbol === 'string' &&
  typeof (value as SymbolInfo).name === 'string';

const parseStocks = (stored: unknown) => (Array.isArray(stored) ? stored.filter(isStock) : null);

/** Stocks added from the Fetch tab, so they show up next to the built-in ones. */
export function useSavedStocks() {
  const [stocks, setStocks] = useLocalStorageState<SymbolInfo[]>('nse-predictor:fetched-stocks', [], parseStocks);

  const save = useCallback(
    (stock: SymbolInfo) =>
      setStocks((current) =>
        [...current.filter((s) => s.symbol !== stock.symbol), stock].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      ),
    [setStocks],
  );

  const remove = useCallback(
    (symbol: string) => setStocks((current) => current.filter((s) => s.symbol !== symbol)),
    [setStocks],
  );

  return { stocks, save, remove };
}

export type SavedStocks = ReturnType<typeof useSavedStocks>;
