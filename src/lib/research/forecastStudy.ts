import type { ModelName } from '../../types.ts';
import { blend, HORIZON, MODEL_NAMES, runModels, weightsFromErrors } from '../models/ensemble.ts';
import { hashString } from '../random.ts';
import { logReturns, mean, percentile, std, wilson } from '../stats.ts';
import type { Market, StockSeries } from './series.ts';

export type ForecastKey = 'ensemble' | ModelName | 'baseline';
export const FORECAST_KEYS: ForecastKey[] = ['ensemble', ...MODEL_NAMES, 'baseline'];

export type ForecastRecord = {
  symbol: string;
  date: string;
  /** The outcome, a month later, falls in the sealed test period. */
  holdout: boolean;
  bull: boolean | null;
  start: number;
  actual: number;
  predicted: Record<ForecastKey, number>;
  probUp: number;
  /** Half-width in log price of the 80% range at 1 month: classic (1-year volatility, bell curve) and adaptive (simulated). */
  spreadClassic: number;
  spreadAdaptive: number;
};

const Z_80 = 1.2816;
const WEIGHT_WINDOWS = 6;

export const pctError = (predicted: number, actual: number) => Math.abs(predicted - actual) / actual;
const wentUp = (r: ForecastRecord) => r.actual > r.start;
const calledRight = (r: ForecastRecord, key: ForecastKey) => (key === 'baseline' ? wentUp(r) : r.predicted[key] > r.start === wentUp(r));
const share = <T>(items: T[], test: (item: T) => boolean) => (items.length ? items.filter(test).length / items.length : 0);

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Stands at each month-end, forecasts 22 trading days ahead using only prices up to that day, and records what
 * happened. The blend's model weights come only from earlier forecasts whose outcome was already known.
 */
export function forecastRecords(series: StockSeries, market: Market, paths: number, minHistory: number): ForecastRecord[] {
  const records: ForecastRecord[] = [];
  const targets: number[] = [];
  const last = HORIZON - 1;

  for (const origin of market.origins) {
    const i = series.index.get(origin.date);
    if (i === undefined || i + 1 < minHistory || i + HORIZON >= series.prices.length) continue;

    const history = series.prices.slice(0, i + 1);
    const run = runModels(history, hashString(`${series.symbol}:${origin.date}`), { paths });
    const known = records.filter((_, n) => targets[n] <= i).slice(-WEIGHT_WINDOWS);
    const errors = known.length
      ? (Object.fromEntries(MODEL_NAMES.map((m) => [m, mean(known.map((r) => pctError(r.predicted[m], r.actual)))])) as Record<ModelName, number>)
      : null;
    const band = blend(run, weightsFromErrors(errors), 1);
    const start = history[i];

    records.push({
      symbol: series.symbol,
      date: origin.date,
      holdout: series.dates[i + HORIZON] > market.holdoutStart,
      bull: origin.bull,
      start,
      actual: series.prices[i + HORIZON],
      predicted: {
        ensemble: band.mid[last],
        trend: run.perModel.trend[last],
        holt: run.perModel.holt[last],
        gbm: run.perModel.gbm[last],
        baseline: start,
      },
      probUp: run.simulation.probUp,
      spreadClassic: Z_80 * std(logReturns(history.slice(-253))) * Math.sqrt(HORIZON),
      spreadAdaptive: Math.log(band.high[last] / band.low[last]) / 2,
    });
    targets.push(i + HORIZON);
  }
  return records;
}

/** The actual move relative to the adaptive range's half-width: 1 or less means inside the unscaled range. */
const rangeRatio = (r: ForecastRecord) => Math.abs(Math.log(r.actual / r.predicted.ensemble)) / r.spreadAdaptive;

/** How much to widen or narrow the adaptive range so that 80% of these outcomes land inside it. */
export function calibratedRangeScale(records: ForecastRecord[]): number {
  const ratios = records
    .map(rangeRatio)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return ratios.length ? percentile(ratios, 0.8) : 1;
}

export type ModelAccuracy = { key: ForecastKey; error: number; hitRate: number; ci: [number, number] };

export type ForecastSummary = {
  predictions: number;
  months: number;
  /** Share of predictions where the price actually rose; "always up" gets this direction score for free. */
  upRate: number;
  models: ModelAccuracy[];
  stocks: number;
  stocksBeatingBaseline: number;
  /** Mean squared error of "chance of ending higher" (lower is better), and of always saying the base rate. */
  brier: number;
  brierBaseRate: number;
  coverageClassic: number;
  coverageAdaptive: number;
  coverageCalibrated: number;
};

export function summarizeForecasts(records: ForecastRecord[], rangeScale: number, baseRate: number): ForecastSummary | null {
  if (records.length === 0) return null;
  const n = records.length;
  const bySymbol = groupBy(records, (r) => r.symbol);
  return {
    predictions: n,
    months: new Set(records.map((r) => r.date)).size,
    upRate: share(records, wentUp),
    models: FORECAST_KEYS.map((key) => {
      const hits = records.filter((r) => calledRight(r, key)).length;
      return { key, error: mean(records.map((r) => pctError(r.predicted[key], r.actual))), hitRate: hits / n, ci: wilson(hits, n) };
    }),
    stocks: bySymbol.size,
    stocksBeatingBaseline: [...bySymbol.values()].filter(
      (rs) => mean(rs.map((r) => pctError(r.predicted.ensemble, r.actual))) < mean(rs.map((r) => pctError(r.start, r.actual))),
    ).length,
    brier: mean(records.map((r) => (r.probUp - Number(wentUp(r))) ** 2)),
    brierBaseRate: mean(records.map((r) => (baseRate - Number(wentUp(r))) ** 2)),
    coverageClassic: share(records, (r) => Math.abs(Math.log(r.actual / r.predicted.ensemble)) <= r.spreadClassic),
    coverageAdaptive: share(records, (r) => rangeRatio(r) <= 1),
    coverageCalibrated: share(records, (r) => rangeRatio(r) <= rangeScale),
  };
}

export type YearAccuracy = { year: string; predictions: number; ensembleError: number; baselineError: number; hitRate: number; upRate: number };

export function accuracyByYear(records: ForecastRecord[]): YearAccuracy[] {
  return [...groupBy(records, (r) => r.date.slice(0, 4)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, rs]) => ({
      year,
      predictions: rs.length,
      ensembleError: mean(rs.map((r) => pctError(r.predicted.ensemble, r.actual))),
      baselineError: mean(rs.map((r) => pctError(r.start, r.actual))),
      hitRate: share(rs, (r) => calledRight(r, 'ensemble')),
      upRate: share(rs, wentUp),
    }));
}

export type RegimeAccuracy = { predictions: number; hitRate: number | null; upRate: number | null };

export function accuracyByRegime(records: ForecastRecord[]): { bull: RegimeAccuracy; bear: RegimeAccuracy } {
  const summary = (rs: ForecastRecord[]): RegimeAccuracy => ({
    predictions: rs.length,
    hitRate: rs.length ? share(rs, (r) => calledRight(r, 'ensemble')) : null,
    upRate: rs.length ? share(rs, wentUp) : null,
  });
  return { bull: summary(records.filter((r) => r.bull === true)), bear: summary(records.filter((r) => r.bull === false)) };
}

export type TrustGrade = 'high' | 'medium' | 'low' | 'unrated';

export type Trust = {
  grade: TrustGrade;
  months: number;
  ensembleError: number | null;
  baselineError: number | null;
  hitRate: number | null;
  upRate: number | null;
  coverage: number | null;
};

/**
 * Rules fixed before testing. High: beat "no change" by 3%+, called direction better than always guessing the more
 * common one, and the range held 70–90% of outcomes. Low: 3%+ worse than "no change", or a range far off 80%.
 */
export function trustFor(records: ForecastRecord[], rangeScale: number, minMonths: number): Trust {
  if (records.length === 0) {
    return { grade: 'unrated', months: 0, ensembleError: null, baselineError: null, hitRate: null, upRate: null, coverage: null };
  }
  const ensembleError = mean(records.map((r) => pctError(r.predicted.ensemble, r.actual)));
  const baselineError = mean(records.map((r) => pctError(r.start, r.actual)));
  const hitRate = share(records, (r) => calledRight(r, 'ensemble'));
  const upRate = share(records, wentUp);
  const coverage = share(records, (r) => rangeRatio(r) <= rangeScale);

  let grade: TrustGrade = 'medium';
  if (records.length < minMonths) grade = 'unrated';
  else if (ensembleError > baselineError * 1.03 || coverage < 0.6 || coverage > 0.95) grade = 'low';
  else if (ensembleError <= baselineError * 0.97 && hitRate > Math.max(upRate, 1 - upRate) && coverage >= 0.7 && coverage <= 0.9) grade = 'high';

  return { grade, months: records.length, ensembleError, baselineError, hitRate, upRate, coverage };
}
