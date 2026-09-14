export function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

/** Sample standard deviation. */
export function std(values: ArrayLike<number>): number {
  const m = mean(values);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i] - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/** Percentile (p from 0 to 1) of an already sorted array, with linear interpolation. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/** Least-squares line through y[x] for x = 0, 1, 2, ... */
export function linreg(y: ArrayLike<number>): { intercept: number; slope: number } {
  const n = y.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(y);
  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < n; x++) {
    numerator += (x - xMean) * (y[x] - yMean);
    denominator += (x - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

export function logReturns(prices: ArrayLike<number>): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  return returns;
}
