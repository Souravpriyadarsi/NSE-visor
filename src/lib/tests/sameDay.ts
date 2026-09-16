import type { HistoryFile } from '../../types.ts';
import { SUSPICIOUS_LOG_MOVE } from '../data/yahoo.ts';
import { subtractDays, subtractMonths } from '../dates.ts';
import { maxDrawdown } from '../stats.ts';
import { orderCharges, type TradeKind } from './costs.ts';

/** Number of shares bought and sold on every trade. */
export const TEST_SHARES = [50, 100, 200] as const;

export type PeriodKey = '1W' | '1M' | '1Y' | '3Y' | '5Y' | 'all';
export const TEST_PERIODS: { key: PeriodKey; label: string; months: number | null; days?: number }[] = [
  { key: '1W', label: '1 week', months: null, days: 7 },
  { key: '1M', label: '1 month', months: 1 },
  { key: '1Y', label: '1 year', months: 12 },
  { key: '3Y', label: '3 years', months: 36 },
  { key: '5Y', label: '5 years', months: 60 },
  { key: 'all', label: 'All', months: null },
];

/** Start date for a preset period ending at lastDate; null means all history. */
export function periodStart(period: PeriodKey, lastDate: string): string | null {
  const preset = TEST_PERIODS.find((p) => p.key === period)!;
  if (preset.days != null) return subtractDays(lastDate, preset.days);
  return preset.months == null ? null : subtractMonths(lastDate, preset.months);
}

export type SeriesResult = {
  /** Value at the end of each trading day: the starting position's value plus profits and losses so far. */
  values: number[];
  final: number;
  /** Profit or loss relative to the starting position's value. */
  totalReturn: number;
  annualReturn: number | null;
  maxDrawdown: number;
};

export type StrategyResult = SeriesResult & {
  trades: number;
  wins: number;
  charges: number;
  /** Days skipped because the price jumped over 30%, usually a split Yahoo hasn't adjusted. */
  skippedDays: number;
};

export type SameDayResult = {
  dates: string[];
  /** Value of the shares at the first day's close. */
  startValue: number;
  stock: SeriesResult;
  overnight: StrategyResult;
  intraday: StrategyResult;
};

/** from: first trading day to include (YYYY-MM-DD), or null for all history. */
export type SameDayOptions = { shares: number; withCosts: boolean; from: string | null };

/** public/research/same-day.json: returns per stock for every share count, charges setting and period. */
export type SameDaySummary = {
  generatedAt: string;
  stocks: {
    symbol: string;
    name: string;
    /** Closing price on each period's first trading day; times the share count gives the starting value. */
    starts: Partial<Record<PeriodKey, number>>;
    results: Record<string, [holding: number, overnight: number, intraday: number]>;
  }[];
};

export const summaryKey = (shares: number, withCosts: boolean, period: PeriodKey) => `${shares}|${withCosts ? 'net' : 'gross'}|${period}`;

const TRADING_DAYS_PER_YEAR = 252;
const suspicious = (from: number, to: number) => Math.abs(Math.log(to / from)) > SUSPICIOUS_LOG_MOVE;

function summarize(values: number[], startValue: number): SeriesResult {
  const final = values[values.length - 1];
  const steps = values.length - 1;
  return {
    values,
    final,
    totalReturn: final / startValue - 1,
    annualReturn: final > 0 && steps > 0 ? (final / startValue) ** (TRADING_DAYS_PER_YEAR / steps) - 1 : null,
    maxDrawdown: Math.min(1, maxDrawdown(values)),
  };
}

/**
 * Trades the same number of shares every day from the start date, without reinvesting profits:
 * overnight buys at each close and sells at the next open; intraday buys at each open and sells at that close.
 * The holding line is simply the shares' value at each close, with no charges.
 */
export function sameDayTest(history: HistoryFile, { shares, withCosts, from }: SameDayOptions): SameDayResult | null {
  // Yahoo adds zero-volume placeholder rows on some holidays; they have no real open or close.
  const rows = history.rows.filter((row) => row[6] > 0 && row[1] > 0 && row[4] > 0 && (from == null || row[0] >= from));
  if (rows.length < 2) return null;

  const startValue = shares * rows[0][4];
  const charges = (value: number, side: 'buy' | 'sell', kind: TradeKind) => (withCosts ? orderCharges(value, side, kind) : 0);

  function simulate(kind: TradeKind, pricesOn: (i: number) => [buy: number, sell: number]): StrategyResult {
    let value = startValue;
    let trades = 0;
    let wins = 0;
    let paid = 0;
    let skippedDays = 0;
    const values = [value];

    for (let i = 1; i < rows.length; i++) {
      const [buy, sell] = pricesOn(i);
      if (suspicious(buy, sell)) {
        skippedDays++;
      } else {
        const cost = charges(shares * buy, 'buy', kind) + charges(shares * sell, 'sell', kind);
        const profit = shares * (sell - buy) - cost;
        trades++;
        if (profit > 0) wins++;
        paid += cost;
        value += profit;
      }
      values.push(value);
    }
    return { ...summarize(values, startValue), trades, wins, charges: paid, skippedDays };
  }

  const holding = [startValue];
  for (let i = 1; i < rows.length; i++) {
    const [previous, close] = [rows[i - 1][4], rows[i][4]];
    holding.push(holding[i - 1] * (suspicious(previous, close) ? 1 : close / previous));
  }

  return {
    dates: rows.map((row) => row[0]),
    startValue,
    stock: summarize(holding, startValue),
    overnight: simulate('delivery', (i) => [rows[i - 1][4], rows[i][1]]),
    intraday: simulate('intraday', (i) => [rows[i][1], rows[i][4]]),
  };
}
