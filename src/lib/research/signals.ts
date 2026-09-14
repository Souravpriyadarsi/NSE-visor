import { mean, percentileRanks, std, windowMean } from '../stats.ts';

export type SignalKey = 'momentum12' | 'momentum6' | 'lowVolatility' | 'trend200' | 'reversal1m';
export type RankKey = SignalKey | 'composite';
export type SignalDefinition = { key: RankKey; label: string; description: string };

const MONTH = 21;
/** Trading days of history every signal needs. */
export const SIGNAL_LOOKBACK = 252;

function dailyVolatility(prices: ArrayLike<number>, from: number, to: number): number {
  const returns: number[] = [];
  for (let k = from; k <= to; k++) returns.push(Math.log(prices[k] / prices[k - 1]));
  return std(returns);
}

/** Ranking signals with published evidence. Higher value = ranked higher. */
export const SIGNALS: (SignalDefinition & { key: SignalKey; compute: (prices: ArrayLike<number>, i: number) => number })[] = [
  {
    key: 'momentum12',
    label: '12-month momentum',
    description: 'Return over the past year, skipping the latest month.',
    compute: (p, i) => p[i - MONTH] / p[i - 252] - 1,
  },
  {
    key: 'momentum6',
    label: '6-month momentum',
    description: 'Return over the past 6 months, skipping the latest month.',
    compute: (p, i) => p[i - MONTH] / p[i - 126] - 1,
  },
  {
    key: 'lowVolatility',
    label: 'Low volatility',
    description: "Calmer stocks rank higher (minus the last year's daily volatility).",
    compute: (p, i) => -dailyVolatility(p, i - 251, i),
  },
  {
    key: 'trend200',
    label: 'Above 200-day average',
    description: 'How far the price is above its 200-day average.',
    compute: (p, i) => p[i] / windowMean(p, i - 199, i) - 1,
  },
  {
    key: 'reversal1m',
    label: '1-month reversal',
    description: "Last month's biggest losers rank highest.",
    compute: (p, i) => -(p[i] / p[i - MONTH] - 1),
  },
];

/** Chosen before any testing, so it can't be tuned to the results. */
export const COMPOSITE = {
  key: 'composite',
  label: 'Momentum + low volatility',
  description: 'Average of the 12-month momentum and low-volatility ranks, fixed before testing.',
  parts: ['momentum12', 'lowVolatility'],
} as const satisfies SignalDefinition & { parts: readonly SignalKey[] };

export const RANK_SIGNALS: SignalDefinition[] = [COMPOSITE, ...SIGNALS];

/** Every signal for a stock as of day i, or null without a year of history. */
export function signalValues(prices: ArrayLike<number>, i: number): Record<SignalKey, number> | null {
  if (i < SIGNAL_LOOKBACK) return null;
  const values = {} as Record<SignalKey, number>;
  for (const signal of SIGNALS) values[signal.key] = signal.compute(prices, i);
  return values;
}

/** Scores for a group of stocks on one day: each signal plus the composite (average of its parts' percentile ranks). */
export function rankScores(values: Record<SignalKey, number>[]): Record<RankKey, number>[] {
  const parts = COMPOSITE.parts.map((key) => percentileRanks(values.map((v) => v[key])));
  return values.map((v, n) => ({ ...v, composite: mean(parts.map((p) => p[n])) }));
}
