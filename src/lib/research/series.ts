import type { HistoryFile } from '../../types.ts';
import { modelPrices } from '../analyze.ts';
import { subtractMonths } from '../dates.ts';
import { windowMean } from '../stats.ts';

/** One stock's adjusted prices with a date lookup. */
export type StockSeries = {
  symbol: string;
  name: string;
  industry: string;
  dates: string[];
  prices: number[];
  index: Map<string, number>;
};

/** A month-end the backtest stands on, with the market's state that day. */
export type Origin = { date: string; bull: boolean | null; vix: number | null };

export type Market = {
  nifty: StockSeries;
  origins: Origin[];
  latestDate: string;
  /** Outcomes after this date form the sealed test period. */
  holdoutStart: string;
};

export function toSeries(history: HistoryFile, industry = ''): StockSeries {
  const dates = history.rows.map((row) => row[0]);
  return {
    symbol: history.symbol,
    name: history.name,
    industry,
    dates,
    prices: modelPrices(history.rows),
    index: new Map(dates.map((date, i) => [date, i])),
  };
}

/** Index of the last trading day of each completed month. */
export function monthEndIndices(dates: string[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i + 1 < dates.length; i++) if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) indices.push(i);
  return indices;
}

/** Month-ends on NIFTY 50's calendar, each marked bull (NIFTY above its 200-day average) or not, with India VIX. */
export function buildMarket(nifty: StockSeries, vix: Map<string, number> | null, holdoutMonths: number): Market {
  const latestDate = nifty.dates[nifty.dates.length - 1];
  return {
    nifty,
    latestDate,
    holdoutStart: subtractMonths(latestDate, holdoutMonths),
    origins: monthEndIndices(nifty.dates).map((i) => ({
      date: nifty.dates[i],
      bull: i >= 199 ? nifty.prices[i] > windowMean(nifty.prices, i - 199, i) : null,
      vix: vix?.get(nifty.dates[i]) ?? null,
    })),
  };
}
