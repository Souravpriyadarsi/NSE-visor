const SMOOTHING_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const DAMPING_GRID = [0.8, 0.9, 0.98];

/**
 * Damped Holt exponential smoothing on log prices: tracks a level and a trend,
 * and the trend fades out over the horizon. Parameters are picked by grid search
 * on one-step-ahead error.
 */
export function holt(prices: number[], horizon: number, window = 252): number[] {
  const y = prices.slice(-window).map((p) => Math.log(p));
  if (y.length < 3) return new Array<number>(horizon).fill(prices[prices.length - 1]);

  let best = { sse: Infinity, level: y[y.length - 1], trend: 0, phi: 1 };
  for (const alpha of SMOOTHING_GRID) {
    for (const beta of SMOOTHING_GRID) {
      for (const phi of DAMPING_GRID) {
        let level = y[0];
        let trend = y[1] - y[0];
        let sse = 0;
        for (let t = 1; t < y.length; t++) {
          const predicted = level + phi * trend;
          const error = y[t] - predicted;
          sse += error * error;
          const newLevel = alpha * y[t] + (1 - alpha) * predicted;
          trend = beta * (newLevel - level) + (1 - beta) * phi * trend;
          level = newLevel;
        }
        if (sse < best.sse) best = { sse, level, trend, phi };
      }
    }
  }

  const forecast: number[] = [];
  let dampedSteps = 0;
  for (let k = 1; k <= horizon; k++) {
    dampedSteps += best.phi ** k;
    forecast.push(Math.exp(best.level + dampedSteps * best.trend));
  }
  return forecast;
}
