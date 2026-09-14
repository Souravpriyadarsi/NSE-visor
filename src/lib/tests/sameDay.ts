import type { HistoryFile } from '../../types.ts';
import { SUSPICIOUS_LOG_MOVE } from '../data/yahoo.ts';
import { subtractMonths } from '../dates.ts';
import { maxDrawdown } from '../stats.ts';
import { affordableShares, orderCharges, type TradeKind } from './costs.ts';

export const TEST_AMOUNTS = [5000, 10000] as const;

export type PeriodKey = '1Y' | '3Y' | '5Y' | 'all';
export const TEST_PERIODS: { key: PeriodKey; label: string; months: number | null }[] = [
  { key: '1Y', label: '1 year', months: 12 },
  { key: '3Y', label: '3 years', months: 36 },
  { key: '5Y', label: '5 years', months: 60 },
  { key: 'all', label: 'All', months: null },
];

/** Start date for a preset period ending at lastDate; null means all history. */
export function periodStart(period: PeriodKey, lastDate: string): string | null {
  const months = TEST_PERIODS.find((p) => p.key === period)!.months;
  return months == null ? null : subtractMonths(lastDate, months);
}

export type SeriesResult = {
  /** Money at the end of each trading day, starting with the amount. */
  values: number[];
  final: number;
  totalReturn: number;
  annualReturn: number | null;
  maxDrawdown: number;
};

export type StrategyResult = SeriesResult & {
  trades: number;
  wins: number;
  charges: number;
  /** Days with no trade because the money couldn't buy one share. */
  unaffordableDays: number;
  /** Days skipped because the price jumped over 30%, usually a split Yahoo hasn't adjusted. */
  skippedDays: number;
};

export type SameDayResult = { dates: string[]; stock: SeriesResult; overnight: StrategyResult; intraday: StrategyResult };
/** from: first trading day to include (YYYY-MM-DD), or null for all history. */
export type SameDayOptions = { amount: number; withCosts: boolean; from: string | null };

/** public/research/same-day.json: total returns per stock for every amount, charges setting and period. */
export type SameDaySummary = {
  generatedAt: string;
  stocks: {
    symbol: string;
    name: string;
    results: Record<string, [holding: number, overnight: number, intraday: number, overnightTrades: number, intradayTrades: number]>;
  }[];
};

export const summaryKey = (amount: number, withCosts: boolean, period: PeriodKey) => `${amount}|${withCosts ? 'net' : 'gross'}|${period}`;

const TRADING_DAYS_PER_YEAR = 252;
const suspicious = (from: number, to: number) => Math.abs(Math.log(to / from)) > SUSPICIOUS_LOG_MOVE;

function summarize(values: number[], amount: number): SeriesResult {
  const final = values[values.length - 1];
  const steps = values.length - 1;
  return {
    values,
    final,
    totalReturn: final / amount - 1,
    annualReturn: final > 0 && steps > 0 ? (final / amount) ** (TRADING_DAYS_PER_YEAR / steps) - 1 : null,
    maxDrawdown: Math.min(1, maxDrawdown(values)),
  };
}

/**
 * Trades the stock every day from the start date, reinvesting everything in whole shares:
 * overnight buys at each close and sells at the next open; intraday buys at each open and sells at that close.
 * The holding line simply follows the closing price, with no charges.
 */
export function sameDayTest(history: HistoryFile, { amount, withCosts, from }: SameDayOptions): SameDayResult | null {
  // Yahoo adds zero-volume placeholder rows on some holidays; they have no real open or close.
  const rows = history.rows.filter((row) => row[6] > 0 && row[1] > 0 && row[4] > 0 && (from == null || row[0] >= from));
  if (rows.length < 2) return null;

  const charges = (value: number, side: 'buy' | 'sell', kind: TradeKind) => (withCosts ? orderCharges(value, side, kind) : 0);

  function simulate(kind: TradeKind, pricesOn: (i: number) => [buy: number, sell: number]): StrategyResult {
    let cash = amount;
    let trades = 0;
    let wins = 0;
    let paid = 0;
    let unaffordableDays = 0;
    let skippedDays = 0;
    const values = [cash];

    for (let i = 1; i < rows.length; i++) {
      const [buy, sell] = pricesOn(i);
      if (suspicious(buy, sell)) {
        skippedDays++;
      } else {
        // Keep enough for the selling charges too, so a trade can never leave the account negative.
        const shares = affordableShares(cash, buy, (value) => charges(value, 'buy', kind) + charges(value, 'sell', kind));
        if (shares === 0) {
          unaffordableDays++;
        } else {
          const cost = charges(shares * buy, 'buy', kind) + charges(shares * sell, 'sell', kind);
          const next = cash + shares * (sell - buy) - cost;
          trades++;
          if (next > cash) wins++;
          paid += cost;
          cash = next;
        }
      }
      values.push(cash);
    }
    return { ...summarize(values, amount), trades, wins, charges: paid, unaffordableDays, skippedDays };
  }

  const holding = [amount];
  for (let i = 1; i < rows.length; i++) {
    const [previous, close] = [rows[i - 1][4], rows[i][4]];
    holding.push(holding[i - 1] * (suspicious(previous, close) ? 1 : close / previous));
  }

  return {
    dates: rows.map((row) => row[0]),
    stock: summarize(holding, amount),
    overnight: simulate('delivery', (i) => [rows[i - 1][4], rows[i][1]]),
    intraday: simulate('intraday', (i) => [rows[i][1], rows[i][4]]),
  };
}
