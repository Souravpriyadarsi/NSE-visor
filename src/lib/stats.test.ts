import { describe, expect, it } from 'vitest';
import { linreg, logReturns, mean, percentile, std } from './stats.ts';

describe('stats', () => {
  it('computes mean and sample standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('interpolates percentiles of a sorted array', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.1)).toBeCloseTo(14);
  });

  it('recovers the growth rate of an exponential series', () => {
    const logPrices = Array.from({ length: 100 }, (_, t) => Math.log(50 * Math.exp(0.01 * t)));
    const { slope, intercept } = linreg(logPrices);
    expect(slope).toBeCloseTo(0.01, 10);
    expect(intercept).toBeCloseTo(Math.log(50), 8);
  });

  it('computes log returns', () => {
    expect(logReturns([100, 110])[0]).toBeCloseTo(Math.log(1.1));
  });
});
