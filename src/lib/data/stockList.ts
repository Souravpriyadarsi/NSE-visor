import type { SymbolInfo } from '../../types.ts';
import { isValidSymbol } from './symbols.ts';

/** Every stock listed on NSE, as published by NSE itself. */
export const NSE_EQUITY_LIST_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';

/** public/data/nse-stocks.json. Symbols are NSE's own (no ".NS"); series is EQ, BE or BZ. */
export type StockListFile = { updatedAt: string; stocks: [symbol: string, name: string, series: string][] };

export type ListedStock = SymbolInfo & { series: string };

const COLUMNS = 8; // SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE

/** Parses NSE's EQUITY_L.csv. Names aren't quoted, so a comma inside a name shows up as extra columns. */
export function parseEquityList(csv: string): StockListFile['stocks'] {
  const stocks: StockListFile['stocks'] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const fields = line.split(',').map((f) => f.trim());
    if (fields.length < COLUMNS) continue;
    const extra = fields.length - COLUMNS;
    const symbol = fields[0].toUpperCase();
    const name = fields.slice(1, 2 + extra).join(', ');
    const series = fields[2 + extra] || 'EQ';
    if (name && isValidSymbol(`${symbol}.NS`)) stocks.push([symbol, name, series]);
  }
  return stocks;
}

export function toListedStocks(file: StockListFile): ListedStock[] {
  return file.stocks.map(([symbol, name, series]) => ({ symbol: `${symbol}.NS`, name, series }));
}
