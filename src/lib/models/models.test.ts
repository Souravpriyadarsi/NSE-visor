import { describe, expect, it } from 'vitest';
import { mulberry32, normal } from '../random.ts';
import { backtest, MIN_BACKTEST_BARS } from './backtest.ts';
import { forecast, HORIZON, weightsFromErrors } from './ensemble.ts';
import { estimateVolatility, gbm } from './gbm.ts';
import { holt } from './holt.ts';
import { linearTrend } from './linearTrend.ts';

const exponential = (length: number, rate: number) => Array.from({ length }, (_, t) => 100 * Math.exp(rate * t));

function noisy(length: number, seed: number): number[] {
  const random = mulberry32(seed);
  const prices = [100];
  for (let i = 1; i < length; i++) prices.push(prices[i - 1] * Math.exp(0.0005 + 0.015 * normal(random)));
  return prices;
}

describe('linearTrend', () => {
  it('continues an exact exponential trend', () => {
    const prices = exponential(300, 0.01);
    const last = prices[prices.length - 1];
    const result = linearTrend(prices, HORIZON);
    expect(result).toHaveLength(HORIZON);
    result.forEach((value, k) => expect(value / (last * Math.exp(0.01 * (k + 1)))).toBeCloseTo(1, 8));
  });
});

describe('holt', () => {
  it('follows a log-linear series closely, with a damped trend', () => {
    const prices = exponential(300, 0.01);
    const last = prices[prices.length - 1];
    const result = holt(prices, HORIZON);
    expect(Math.abs(result[0] / (last * Math.exp(0.01)) - 1)).toBeLessThan(0.005);
    for (let k = 1; k < HORIZON; k++) expect(result[k]).toBeGreaterThan(result[k - 1]);
    expect(result[HORIZON - 1]).toBeLessThan(last * Math.exp(0.01 * HORIZON));
  });
});

describe('gbm', () => {
  it('matches the drift exactly when there is no volatility', () => {
    const prices = exponential(600, 0.001);
    const last = prices[prices.length - 1];
    const result = gbm(prices, HORIZON, 1);
    expect(result.mid[HORIZON - 1] / (last * Math.exp(0.001 * HORIZON))).toBeCloseTo(1, 6);
    expect(result.high[HORIZON - 1] / result.low[HORIZON - 1]).toBeCloseTo(1, 6);
    expect(result.probUp).toBe(1);
  });

  it('is reproducible for a seed and has a widening range', () => {
    const prices = noisy(600, 3);
    const a = gbm(prices, HORIZON, 99);
    expect(gbm(prices, HORIZON, 99)).toEqual(a);
    expect(gbm(prices, HORIZON, 100).mid).not.toEqual(a.mid);
    expect(a.high[HORIZON - 1] - a.low[HORIZON - 1]).toBeGreaterThan(a.high[0] - a.low[0]);
  });
});

describe('estimateVolatility', () => {
  it('reacts to recent turbulence faster than the 1-year estimate', () => {
    const random = mulberry32(7);
    const returns = Array.from({ length: 600 }, (_, t) => (t < 560 ? 0.01 : 0.04) * normal(random));
    const classic = estimateVolatility(returns, 'classic');
    const adaptive = estimateVolatility(returns, 'adaptive');
    expect(classic.shocks).toBeNull();
    expect(adaptive.volatility).toBeGreaterThan(classic.volatility);
    expect(adaptive.shocks).toHaveLength(504);
  });

  it('keeps reproducible, widening ranges with resampled moves', () => {
    const prices = noisy(600, 4);
    const a = gbm(prices, HORIZON, 5, { method: 'adaptive', paths: 500 });
    expect(gbm(prices, HORIZON, 5, { method: 'adaptive', paths: 500 })).toEqual(a);
    expect(a.high[HORIZON - 1] - a.low[HORIZON - 1]).toBeGreaterThan(a.high[0] - a.low[0]);
  });
});

describe('ensemble', () => {
  it('weights models equally without errors, and favours lower error otherwise', () => {
    expect(weightsFromErrors(null)).toEqual({ trend: 1 / 3, holt: 1 / 3, gbm: 1 / 3 });
    const weights = weightsFromErrors({ trend: 0.02, holt: 0.04, gbm: 0.08 });
    expect(weights.trend).toBeGreaterThan(weights.holt);
    expect(weights.holt).toBeGreaterThan(weights.gbm);
    expect(weights.gbm).toBeGreaterThanOrEqual(0.15);
    expect(weights.trend + weights.holt + weights.gbm).toBeCloseTo(1, 10);
  });

  it('produces dated forecasts with low <= mid <= high', () => {
    const result = forecast(noisy(600, 5), '2026-09-11', 1, null);
    expect(result.dates).toHaveLength(HORIZON);
    expect(result.dates[0]).toBe('2026-09-14');
    result.mid.forEach((mid, k) => {
      expect(result.low[k]).toBeLessThanOrEqual(mid);
      expect(result.high[k]).toBeGreaterThanOrEqual(mid);
    });
  });
});

describe('backtest', () => {
  it('needs enough history', () => {
    expect(backtest(noisy(MIN_BACKTEST_BARS - 1, 1), 1)).toBeNull();
  });

  it('scores a perfect trend as near-zero error for the trend model', () => {
    const result = backtest(exponential(400, 0.001), 1)!;
    const score = (key: string) => result.scores.find((s) => s.key === key)!;
    expect(score('trend').mape).toBeLessThan(1e-9);
    expect(score('trend').directionHits).toBe(6);
    expect(score('baseline').mape).toBeGreaterThan(0.005);
    expect(score('baseline').directionHits).toBeNull();
  });

  it('reports sensible metrics on noisy data', () => {
    const result = backtest(noisy(800, 11), 1)!;
    expect(result.scores.map((s) => s.key)).toEqual(['ensemble', 'trend', 'holt', 'gbm', 'baseline']);
    expect(result.bandCoverage).toBeGreaterThanOrEqual(0);
    expect(result.bandCoverage).toBeLessThanOrEqual(1);
    for (const s of result.scores) expect(s.mape).toBeGreaterThan(0);
  });
});
