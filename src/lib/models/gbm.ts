import { mulberry32, normal } from '../random.ts';
import { logReturns, mean, percentile, std } from '../stats.ts';

export type GbmResult = { mid: number[]; low: number[]; high: number[]; probUp: number };

/**
 * classic: the last year's volatility, with bell-curve daily moves.
 * adaptive: volatility that reacts to recent turbulence (half recent-weighted, half last year), with daily
 * moves resampled from the stock's own past so sudden big moves (fat tails) aren't smoothed away.
 */
export type VolatilityMethod = 'classic' | 'adaptive';
export type GbmOptions = { paths?: number; method?: VolatilityMethod };

/** Weight kept by yesterday's variance each day in the recent-weighted estimate (RiskMetrics uses 0.94). */
const EWMA_LAMBDA = 0.94;

export function estimateVolatility(returns: number[], method: VolatilityMethod): { volatility: number; shocks: Float64Array | null } {
  const yearly = std(returns.slice(-252));
  if (method === 'classic' || !(yearly > 0)) return { volatility: yearly || 0, shocks: null };

  const recent = returns.slice(-504);
  const centre = mean(recent);
  let variance = yearly ** 2;
  const shocks = new Float64Array(recent.length);
  for (let t = 0; t < recent.length; t++) {
    const deviation = recent[t] - centre;
    shocks[t] = deviation / Math.sqrt(variance);
    variance = EWMA_LAMBDA * variance + (1 - EWMA_LAMBDA) * deviation ** 2;
  }
  // Rescale the day-by-day standardized moves to mean 0 and spread 1, keeping their shape.
  const shift = mean(shocks);
  const spread = std(shocks);
  for (let t = 0; t < shocks.length; t++) shocks[t] = spread > 0 ? (shocks[t] - shift) / spread : 0;
  return { volatility: Math.sqrt(0.5 * variance + 0.5 * yearly ** 2), shocks };
}

/**
 * Monte Carlo random walk (geometric Brownian motion): simulates many possible
 * price paths using the stock's historical drift and volatility, then reads the
 * median and the 10th/90th percentiles at each future day.
 */
export function gbm(prices: number[], horizon: number, seed: number, { paths = 2000, method = 'classic' }: GbmOptions = {}): GbmResult {
  const returns = logReturns(prices);
  // Mean of log returns already includes the -σ²/2 correction, so it is not subtracted again.
  const drift = mean(returns.slice(-504));
  const { volatility, shocks } = estimateVolatility(returns, method);
  const random = mulberry32(seed);
  const draw = shocks ? () => shocks[Math.floor(random() * shocks.length)] : () => normal(random);
  const logStart = Math.log(prices[prices.length - 1]);

  const byDay = Array.from({ length: horizon }, () => new Float64Array(paths));
  let endedHigher = 0;
  for (let p = 0; p < paths; p++) {
    let logPrice = logStart;
    for (let k = 0; k < horizon; k++) {
      logPrice += drift + volatility * draw();
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
