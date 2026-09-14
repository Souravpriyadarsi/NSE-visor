import type { HistoryFile, Row, SymbolInfo } from '../types.ts';
import { mean } from './stats.ts';

export const NIFTY_SYMBOL = '^NSEI';
/** Share of the composite ranking each paper portfolio holds, matching the research backtest. */
export const PORTFOLIO_TOP_SHARE = 0.2;

/** Saved on the first evening update of each month: the top of the research ranking at that day's closes. */
export type PaperPortfolio = {
  month: string;
  date: string;
  holdings: (SymbolInfo & { close: number })[];
  /** Every ranked stock, for the "average stock" comparison. */
  universe: { symbol: string; close: number }[];
  niftyClose: number | null;
};

export type HoldingResult = SymbolInfo & { entry: number | null; exit: number | null; return: number | null };

export type PortfolioResult = {
  month: string;
  date: string;
  endDate: string;
  /** Still running: the newest portfolio, measured to the latest close. */
  open: boolean;
  holdings: HoldingResult[];
  return: number | null;
  universeReturn: number | null;
  niftyReturn: number | null;
};

/** public/tracker/portfolios.json */
export type PortfolioReport = {
  updatedAt: string;
  portfolios: PortfolioResult[];
  total: { months: number; portfolio: number | null; universe: number | null; nifty: number | null };
};

/** Closing price on the date, or the last close before it. */
export function closeOn(rows: Row[], date: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] <= date) return rows[i][4];
  return null;
}

const known = (values: (number | null)[]) => values.filter((v): v is number => v != null && Number.isFinite(v));
const averageOrNull = (values: (number | null)[]) => (known(values).length ? mean(known(values)) : null);
const compound = (values: (number | null)[]) => (known(values).length ? known(values).reduce((growth, r) => growth * (1 + r), 1) - 1 : null);

/** The top share of today's ranking at today's closes, or null if the scores aren't from this date. */
export function pickPortfolio(
  scores: { asOf: string; stocks: Record<string, { rank: number | null }> },
  date: string,
  histories: Map<string, HistoryFile>,
): PaperPortfolio | null {
  if (scores.asOf !== date) return null;
  const lastClose = (symbol: string) => {
    const rows = histories.get(symbol)!.rows;
    return rows[rows.length - 1][4];
  };
  const ranked = Object.entries(scores.stocks)
    .filter(([symbol, s]) => s.rank != null && histories.has(symbol))
    .sort(([, a], [, b]) => a.rank! - b.rank!)
    .map(([symbol]) => symbol);
  if (ranked.length === 0) return null;

  const top = ranked.slice(0, Math.max(1, Math.round(ranked.length * PORTFOLIO_TOP_SHARE)));
  return {
    month: date.slice(0, 7),
    date,
    holdings: top.map((symbol) => ({ symbol, name: histories.get(symbol)!.name, close: lastClose(symbol) })),
    universe: ranked.map((symbol) => ({ symbol, close: lastClose(symbol) })),
    niftyClose: histories.has(NIFTY_SYMBOL) ? lastClose(NIFTY_SYMBOL) : null,
  };
}

/** Equal-weight price returns (no dividends or costs) from each portfolio's start to the next one's, or to the latest close. */
export function evaluatePortfolios(portfolios: PaperPortfolio[], histories: Map<string, HistoryFile>, now: Date): PortfolioReport {
  const sorted = [...portfolios].sort((a, b) => a.date.localeCompare(b.date));
  const latestDate =
    histories.get(NIFTY_SYMBOL)?.lastDate ?? [...histories.values()].reduce((latest, h) => (h.lastDate > latest ? h.lastDate : latest), '');

  const results = sorted.map((p, k): PortfolioResult => {
    const endDate = sorted[k + 1]?.date ?? latestDate;
    const move = (symbol: string, savedClose: number | null) => {
      const rows = histories.get(symbol)?.rows;
      // Reading the start price from today's history keeps later split adjustments consistent.
      const entry = (rows && closeOn(rows, p.date)) ?? savedClose;
      const exit = rows ? closeOn(rows, endDate) : null;
      return { entry, exit, return: entry && exit != null ? exit / entry - 1 : null };
    };
    const holdings = p.holdings.map((h) => ({ symbol: h.symbol, name: h.name, ...move(h.symbol, h.close) }));
    return {
      month: p.month,
      date: p.date,
      endDate,
      open: k === sorted.length - 1,
      holdings,
      return: averageOrNull(holdings.map((h) => h.return)),
      universeReturn: averageOrNull(p.universe.map((u) => move(u.symbol, u.close).return)),
      niftyReturn: move(NIFTY_SYMBOL, p.niftyClose).return,
    };
  });

  return {
    updatedAt: now.toISOString(),
    portfolios: results,
    total: {
      months: results.length,
      portfolio: compound(results.map((r) => r.return)),
      universe: compound(results.map((r) => r.universeReturn)),
      nifty: compound(results.map((r) => r.niftyReturn)),
    },
  };
}
