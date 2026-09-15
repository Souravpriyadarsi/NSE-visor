import { isValidSymbol, normalizeSymbol } from './data/symbols.ts';

export const TABS = ['dashboard', 'prices', 'analyze', 'watchlist', 'tracker', 'report', 'tests', 'daytrading', 'fetch'] as const;
export type Tab = (typeof TABS)[number];
export type UrlState = { tab: Tab; symbol: string };

export const DEFAULT_SYMBOL = 'RELIANCE.NS';

/** Reads the page and stock from a query string like "?tab=watchlist&s=TCS.NS". */
export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const rawSymbol = params.get('s');
  const symbol = normalizeSymbol(rawSymbol ?? '');
  // Older links were just "?s=TCS.NS", which meant the Analyze page.
  const tab = TABS.find((t) => t === params.get('tab')) ?? (rawSymbol ? 'analyze' : 'dashboard');
  return { tab, symbol: isValidSymbol(symbol) ? symbol : DEFAULT_SYMBOL };
}

export function buildSearch({ tab, symbol }: UrlState): string {
  return `?${new URLSearchParams({ tab, s: symbol })}`;
}
