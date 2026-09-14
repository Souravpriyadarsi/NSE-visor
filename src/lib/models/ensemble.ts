import type { Forecast, ModelName } from '../../types.ts';
import { nextTradingDays } from '../dates.ts';
import { gbm, type GbmOptions, type GbmResult, type VolatilityMethod } from './gbm.ts';
import { holt } from './holt.ts';
import { linearTrend } from './linearTrend.ts';

/** About one month of trading days. */
export const HORIZON = 22;
export const MIN_FORECAST_BARS = 60;
export const MODEL_NAMES: ModelName[] = ['trend', 'holt', 'gbm'];
const MIN_WEIGHT = 0.15;

/** How the likely range is simulated; compared in the research backtest (scripts/research.ts). */
export const RANGE_METHOD: VolatilityMethod = 'adaptive';
/** Widens (above 1) or narrows the range so about 80% of actual prices land inside it, as measured by the research backtest. */
export const RANGE_SCALE = 1;

export type ModelRun = { perModel: Record<ModelName, number[]>; simulation: GbmResult };

export function runModels(prices: number[], seed: number, options: GbmOptions = {}): ModelRun {
  const simulation = gbm(prices, HORIZON, seed, { method: RANGE_METHOD, ...options });
  return {
    perModel: { trend: linearTrend(prices, HORIZON), holt: holt(prices, HORIZON), gbm: simulation.mid },
    simulation,
  };
}

/** Models with lower backtest error get more weight; every model keeps at least MIN_WEIGHT. */
export function weightsFromErrors(errors: Record<ModelName, number> | null): Record<ModelName, number> {
  if (!errors) return { trend: 1 / 3, holt: 1 / 3, gbm: 1 / 3 };
  const inverse = MODEL_NAMES.map((m) => 1 / Math.max(errors[m], 1e-9));
  const total = inverse.reduce((a, b) => a + b, 0);
  const spare = 1 - MIN_WEIGHT * MODEL_NAMES.length;
  return Object.fromEntries(MODEL_NAMES.map((m, i) => [m, MIN_WEIGHT + (spare * inverse[i]) / total])) as Record<ModelName, number>;
}

/** Weighted average of the models (in log space), with the range taken from the simulation's spread, scaled by rangeScale. */
export function blend(
  run: ModelRun,
  weights: Record<ModelName, number>,
  rangeScale = RANGE_SCALE,
): { mid: number[]; low: number[]; high: number[] } {
  const mid: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  const { simulation } = run;
  for (let k = 0; k < HORIZON; k++) {
    let logMid = 0;
    for (const m of MODEL_NAMES) logMid += weights[m] * Math.log(run.perModel[m][k]);
    const value = Math.exp(logMid);
    mid.push(value);
    low.push(value * (simulation.low[k] / simulation.mid[k]) ** rangeScale);
    high.push(value * (simulation.high[k] / simulation.mid[k]) ** rangeScale);
  }
  return { mid, low, high };
}

export function forecast(
  prices: number[],
  lastDate: string,
  seed: number,
  modelErrors: Record<ModelName, number> | null,
): Forecast {
  const run = runModels(prices, seed);
  const weights = weightsFromErrors(modelErrors);
  return {
    dates: nextTradingDays(lastDate, HORIZON),
    ...blend(run, weights),
    perModel: run.perModel,
    weights,
    probUp: run.simulation.probUp,
  };
}
