import type { SymbolInfo } from '../../types.ts';
import { isValidSymbol, NSE_INDICES } from '../data/symbols.ts';

/** Angel One's public instrument list (no login needed), about 35 MB. */
export const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

export type ScripRow = { token: string; symbol: string; name: string; exch_seg: string; instrumenttype: string };

/** public/data/angel-tokens.json: the app's symbols ("RELIANCE.NS", "^NSEI") mapped to Angel One NSE tokens. */
export type AngelTokens = { updatedAt: string; tokens: Record<string, string> };

/** When a company trades in more than one series, prefer the normal one. */
const SERIES = ['EQ', 'BE', 'BZ'];

export function toAngelTokens(rows: ScripRow[], indices: SymbolInfo[] = NSE_INDICES): Record<string, string> {
  const tokens: Record<string, string> = {};
  const seriesRank = new Map<string, number>();
  for (const row of rows) {
    if (row.exch_seg !== 'NSE') continue;
    const match = /^(.+)-(EQ|BE|BZ)$/.exec(row.symbol);
    if (!match) continue;
    const symbol = `${match[1]}.NS`;
    const rank = SERIES.indexOf(match[2]);
    if (!isValidSymbol(symbol) || (seriesRank.get(symbol) ?? Infinity) <= rank) continue;
    tokens[symbol] = row.token;
    seriesRank.set(symbol, rank);
  }

  // Index rows are named like "Nifty 50" and "India VIX".
  const indexTokens = new Map(
    rows.filter((row) => row.exch_seg === 'NSE' && row.instrumenttype === 'AMXIDX').map((row) => [row.symbol.toUpperCase(), row.token]),
  );
  for (const index of indices) {
    const token = indexTokens.get(index.name.toUpperCase());
    if (token) tokens[index.symbol] = token;
  }
  return tokens;
}
