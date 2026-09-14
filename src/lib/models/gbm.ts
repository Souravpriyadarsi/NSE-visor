import { mulberry32, normal } from '../random.ts';
import { logReturns, mean, percentile, std } from '../stats.ts';

export type GbmResult = { mid: number[]; low: number[]; high: number[]; probUp: number };

/**
 * Monte Carlo random walk (geometric Brownian motion): simulates many possible
 * price paths using the stock's historical drift and volatility, then reads the
 * median and the 10th/90th percentiles at each future day.
 */
export function gbm(prices: number[], horizon: number, seed: number, paths = 2000): GbmResult {
  const returns = logReturns(prices);
  // Mean of log returns already includes the -σ²/2 correction, so it is not subtracted again.
  const drift = mean(returns.slice(-504));
  const volatility = std(returns.slice(-252));
  const random = mulberry32(seed);
  const logStart = Math.log(prices[prices.length - 1]);

  const byDay = Array.from({ length: horizon }, () => new Float64Array(paths));
  let endedHigher = 0;
  for (let p = 0; p < paths; p++) {
    let logPrice = logStart;
    for (let k = 0; k < horizon; k++) {
      logPrice += drift + volatility * normal(random);
      byDay[k][p] = logPrice;
    }
    if (logPrice > logStart) endedHigher++;
  }

  const mid: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (const day of byDay) {
    day.sort();
    mid.push(Math.exp(percentile(day, 0.5)));
    low.push(Math.exp(percentile(day, 0.1)));
    high.push(Math.exp(percentile(day, 0.9)));
  }
  return { mid, low, high, probUp: endedHigher / paths };
}
