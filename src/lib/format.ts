import type { ScoreKey } from './models/backtest.ts';

const numberFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indices (like ^NSEI) are in points; stocks are in rupees. */
export function formatPrice(value: number, symbol: string): string {
  return symbol.startsWith('^') ? numberFormat.format(value) : `₹${numberFormat.format(value)}`;
}

export function formatPct(fraction: number, signed = false): string {
  const text = `${(fraction * 100).toFixed(1)}%`;
  return signed && fraction > 0 ? `+${text}` : text;
}

export const MODEL_LABELS = {
  ensemble: 'Blended forecast',
  trend: 'Trend line',
  holt: 'Holt smoothing',
  gbm: 'Random-walk simulation',
  baseline: 'No-change baseline',
} as const satisfies Record<ScoreKey, string>;
