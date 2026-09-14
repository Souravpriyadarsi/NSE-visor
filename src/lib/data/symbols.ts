import type { SymbolInfo } from '../../types.ts';

/** "reliance" -> "RELIANCE.NS"; symbols that already have a suffix or start with ^ are kept. */
export function normalizeSymbol(input: string): string {
  const symbol = input.trim().toUpperCase();
  if (!symbol || symbol.startsWith('^') || symbol.includes('.')) return symbol;
  return `${symbol}.NS`;
}

export function isValidSymbol(symbol: string): boolean {
  return /^\^?[A-Z0-9&-]{1,20}(\.[A-Z]{1,3})?$/.test(symbol);
}

/** Safe file name: "^NSEI" -> "_NSEI", "M&M.NS" -> "M_M.NS". */
export function fileId(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9.-]/g, '_');
}

export function displaySymbol(symbol: string): string {
  return symbol === '^NSEI' ? 'NIFTY 50' : symbol.replace(/\.NS$/, '');
}

/** Matches search text against known symbols and company names, else treats it as a ticker. */
export function resolveSymbol(text: string, options: SymbolInfo[]): string | null {
  const query = text.trim().toLowerCase();
  if (!query) return null;
  const match =
    options.find((o) => o.symbol.toLowerCase() === query || displaySymbol(o.symbol).toLowerCase() === query) ??
    options.find((o) => o.name.toLowerCase().includes(query));
  if (match) return match.symbol;
  const symbol = normalizeSymbol(text);
  return isValidSymbol(symbol) ? symbol : null;
}
