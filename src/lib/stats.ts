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

/** Mean of values[from..to], both ends included. */
export function windowMean(values: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let k = from; k <= to; k++) sum += values[k];
  return sum / (to - from + 1);
}

/** Rank of each value from 1 (smallest); tied values share their average rank. */
export function ranks(values: ArrayLike<number>): number[] {
  const order = Array.from(values, (value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(order.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end++;
    for (let k = start; k <= end; k++) result[order[k].index] = (start + end) / 2 + 1;
    start = end + 1;
  }
  return result;
}

/** Where each value sits in its group, from 0 (lowest) to 1 (highest). */
export function percentileRanks(values: ArrayLike<number>): number[] {
  const n = values.length;
  return ranks(values).map((rank) => (n > 1 ? (rank - 1) / (n - 1) : 0.5));
}

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const meanA = mean(a);
  const meanB = mean(b);
  let product = 0;
  let squaresA = 0;
  let squaresB = 0;
  for (let i = 0; i < a.length; i++) {
    product += (a[i] - meanA) * (b[i] - meanB);
    squaresA += (a[i] - meanA) ** 2;
    squaresB += (b[i] - meanB) ** 2;
  }
  return squaresA === 0 || squaresB === 0 ? 0 : product / Math.sqrt(squaresA * squaresB);
}

/** Rank correlation: 1 when b always rises with a, -1 when it always falls, 0 for no relation. */
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return pearson(ranks(a), ranks(b));
}

/** 95% confidence interval for a success rate (Wilson score interval). */
export function wilson(hits: number, n: number, z = 1.96): [low: number, high: number] {
  if (n === 0) return [0, 1];
  const p = hits / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** How many standard errors the average is from zero; 2 or more is unlikely to be luck. */
export function tStat(values: ArrayLike<number>): number {
  if (values.length < 2) return 0;
  const spread = std(values);
  return spread === 0 ? 0 : mean(values) / (spread / Math.sqrt(values.length));
}

/** Largest fall from an earlier peak of a growth curve, as a positive fraction. */
export function maxDrawdown(curve: ArrayLike<number>): number {
  let peak = -Infinity;
  let worst = 0;
  for (let i = 0; i < curve.length; i++) {
    peak = Math.max(peak, curve[i]);
    worst = Math.max(worst, 1 - curve[i] / peak);
  }
  return worst;
}

export function logReturns(prices: ArrayLike<number>): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  return returns;
}
