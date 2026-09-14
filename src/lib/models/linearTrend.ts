import { linreg } from '../stats.ts';

/**
 * Fits a straight line to log prices over the last year and continues its slope.
 * Anchored at the last price so the forecast doesn't jump to the fitted line.
 */
export function linearTrend(prices: number[], horizon: number, window = 252): number[] {
  const { slope } = linreg(prices.slice(-window).map((p) => Math.log(p)));
  const logLast = Math.log(prices[prices.length - 1]);
  return Array.from({ length: horizon }, (_, k) => Math.exp(logLast + slope * (k + 1)));
}
