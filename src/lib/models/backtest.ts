import type { ModelName } from '../../types.ts';
import { mean } from '../stats.ts';
import { blend, HORIZON, MODEL_NAMES, runModels, weightsFromErrors } from './ensemble.ts';

export const BACKTEST_WINDOWS = 6;
export const MIN_BACKTEST_BARS = 252 + HORIZON * BACKTEST_WINDOWS;

export type ScoreKey = ModelName | 'ensemble' | 'baseline';

export type Score = {
  key: ScoreKey;
  /** Average of |forecast - actual| / actual over each forecast day. */
  mape: number;
  /** |forecast - actual| / actual on the last forecast day. */
  finalError: number;
  /** Windows where the up/down call was right; null for the no-change baseline. */
  directionHits: number | null;
};

export type BacktestResult = {
  windows: number;
  scores: Score[];
  /** Share of actual prices that fell inside the blended 10th–90th percentile range. */
  bandCoverage: number;
  modelErrors: Record<ModelName, number>;
};

/**
 * Walk-forward test: for each of the last 6 months, forecast it using only the
 * data before it and compare against what actually happened.
 */
export function backtest(prices: number[], seed: number): BacktestResult | null {
  if (prices.length < MIN_BACKTEST_BARS) return null;

  const keys: ScoreKey[] = ['ensemble', ...MODEL_NAMES, 'baseline'];
  const emptyLists = () => Object.fromEntries(keys.map((k) => [k, [] as number[]])) as Record<ScoreKey, number[]>;
  const mapes = emptyLists();
  const finalErrors = emptyLists();
  const hits = Object.fromEntries(keys.map((k) => [k, 0])) as Record<ScoreKey, number>;
  const last = HORIZON - 1;
  let insideBand = 0;

  // Oldest window first, so the ensemble's weights only use earlier windows.
  for (let w = BACKTEST_WINDOWS; w >= 1; w--) {
    const cutoff = prices.length - HORIZON * w;
    const history = prices.slice(0, cutoff);
    const actual = prices.slice(cutoff, cutoff + HORIZON);
    const start = history[history.length - 1];

    const run = runModels(history, seed + w);
    const band = blend(run, weightsFromErrors(mapes.trend.length > 0 ? averageModelErrors(mapes) : null));
    const forecasts: Record<ScoreKey, number[]> = {
      ...run.perModel,
      ensemble: band.mid,
      baseline: new Array<number>(HORIZON).fill(start),
    };

    for (const key of keys) {
      const f = forecasts[key];
      mapes[key].push(mean(actual.map((a, k) => Math.abs(f[k] - a) / a)));
      finalErrors[key].push(Math.abs(f[last] - actual[last]) / actual[last]);
      if (Math.sign(f[last] - start) === Math.sign(actual[last] - start)) hits[key]++;
    }
    insideBand += actual.filter((a, k) => a >= band.low[k] && a <= band.high[k]).length;
  }

  return {
    windows: BACKTEST_WINDOWS,
    scores: keys.map((key) => ({
      key,
      mape: mean(mapes[key]),
      finalError: mean(finalErrors[key]),
      directionHits: key === 'baseline' ? null : hits[key],
    })),
    bandCoverage: insideBand / (HORIZON * BACKTEST_WINDOWS),
    modelErrors: averageModelErrors(mapes),
  };
}

function averageModelErrors(mapes: Record<ScoreKey, number[]>): Record<ModelName, number> {
  return Object.fromEntries(MODEL_NAMES.map((m) => [m, mean(mapes[m])])) as Record<ModelName, number>;
}
