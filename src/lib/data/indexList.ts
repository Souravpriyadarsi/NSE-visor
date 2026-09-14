import type { SymbolInfo } from '../../types.ts';
import { isValidSymbol } from './symbols.ts';

/** NSE's official NIFTY 200 member list: the stocks the research backtest and rankings cover. */
export const NIFTY_200_URL = 'https://nsearchives.nseindia.com/content/indices/ind_nifty200list.csv';

export type UniverseStock = SymbolInfo & { industry: string };

/** public/data/universe.json */
export type UniverseFile = { updatedAt: string; index: string; stocks: UniverseStock[] };

/** Parses an NSE index member CSV: Company Name, Industry, Symbol, Series, ISIN Code. */
export function parseIndexList(csv: string): UniverseStock[] {
  const stocks: UniverseStock[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const fields = line.split(',').map((f) => f.trim());
    if (fields.length < 5) continue;
    const n = fields.length;
    const symbol = `${fields[n - 3].toUpperCase()}.NS`;
    const name = fields.slice(0, n - 4).join(', ');
    if (name && isValidSymbol(symbol)) stocks.push({ symbol, name, industry: fields[n - 4] });
  }
  return stocks;
}
