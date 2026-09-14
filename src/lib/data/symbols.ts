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

/** Main NSE indices that Yahoo Finance has 10-year daily data for. */
export const NSE_INDICES: SymbolInfo[] = [
  { symbol: '^NSEI', name: 'NIFTY 50' },
  { symbol: '^NSMIDCP', name: 'NIFTY NEXT 50' },
  { symbol: '^CNX100', name: 'NIFTY 100' },
  { symbol: '^CNX200', name: 'NIFTY 200' },
  { symbol: '^CRSLDX', name: 'NIFTY 500' },
  { symbol: '^NSEMDCP50', name: 'NIFTY MIDCAP 50' },
  { symbol: '^NSEBANK', name: 'NIFTY BANK' },
  { symbol: '^CNXPSUBANK', name: 'NIFTY PSU BANK' },
  { symbol: '^CNXIT', name: 'NIFTY IT' },
  { symbol: '^CNXAUTO', name: 'NIFTY AUTO' },
  { symbol: '^CNXPHARMA', name: 'NIFTY PHARMA' },
  { symbol: '^CNXFMCG', name: 'NIFTY FMCG' },
  { symbol: '^CNXMETAL', name: 'NIFTY METAL' },
  { symbol: '^CNXREALTY', name: 'NIFTY REALTY' },
  { symbol: '^CNXENERGY', name: 'NIFTY ENERGY' },
  { symbol: '^CNXINFRA', name: 'NIFTY INFRA' },
  { symbol: '^CNXPSE', name: 'NIFTY PSE' },
  { symbol: '^CNXCONSUM', name: 'NIFTY CONSUMPTION' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX' },
];

const indexNames = new Map(NSE_INDICES.map((i) => [i.symbol, i.name]));

export function displaySymbol(symbol: string): string {
  return indexNames.get(symbol) ?? symbol.replace(/\.NS$/, '');
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
