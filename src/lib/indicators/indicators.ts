/** Indicator values aligned with the input prices; null until there is enough data. */
export type Series = (number | null)[];

export type MacdResult = { macd: Series; signal: Series; histogram: Series };

const emptySeries = (length: number): Series => new Array<number | null>(length).fill(null);

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out = emptySeries(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out = emptySeries(values.length);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(values: number[], period = 14): Series {
  const out = emptySeries(values.length);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: Series = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f != null && s != null ? f - s : null;
  });

  const signal = emptySeries(values.length);
  const start = slow - 1;
  if (values.length > start) {
    ema(line.slice(start) as number[], signalPeriod).forEach((value, j) => {
      signal[start + j] = value;
    });
  }

  const histogram: Series = line.map((m, i) => {
    const s = signal[i];
    return m != null && s != null ? m - s : null;
  });
  return { macd: line, signal, histogram };
}
