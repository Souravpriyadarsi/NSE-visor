import { displaySymbol } from './data/symbols.ts';
import type { SymbolInfo } from '../types.ts';

const startsWord = (text: string, query: string) => text.startsWith(query) || text.includes(` ${query}`);

/**
 * Stocks matching search text, best first: exact ticker, ticker prefix, a word in the company name,
 * then anywhere in the ticker or name. Ties keep the list's own order.
 */
export function searchStocks<T extends SymbolInfo>(options: T[], text: string, limit: number): T[] {
  const query = text.trim().toLowerCase();
  if (!query) return options.slice(0, limit);

  const scored: { option: T; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const ticker = displaySymbol(option.symbol).toLowerCase();
    const name = option.name.toLowerCase();
    const score =
      ticker === query ? 0
      : ticker.startsWith(query) ? 1
      : startsWord(name, query) ? 2
      : ticker.includes(query) ? 3
      : name.includes(query) ? 4
      : -1;
    if (score >= 0) scored.push({ option, score, index });
  });

  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.option);
}
