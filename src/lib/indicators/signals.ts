import type { MacdResult, Series } from './indicators.ts';

export type Tone = 'bullish' | 'bearish' | 'neutral';
export type Signal = { label: string; detail: string; tone: Tone };
export type IndicatorSet = { sma50: Series; sma200: Series; rsi: Series; macd: MacdResult };

/** Where series `a` crossed series `b` within the last `lookback` bars, if at all. */
export function recentCross(a: Series, b: Series, lookback: number): 'up' | 'down' | null {
  for (let i = a.length - 1; i > 0 && i >= a.length - lookback; i--) {
    const a0 = a[i - 1];
    const b0 = b[i - 1];
    const a1 = a[i];
    const b1 = b[i];
    if (a0 == null || b0 == null || a1 == null || b1 == null) return null;
    if (a0 <= b0 && a1 > b1) return 'up';
    if (a0 >= b0 && a1 < b1) return 'down';
  }
  return null;
}

/** Plain-English rule-of-thumb readings of the latest indicator values. */
export function computeSignals(closes: number[], ind: IndicatorSet): Signal[] {
  const i = closes.length - 1;
  const price = closes[i];
  const signals: Signal[] = [];

  const sma200 = ind.sma200[i];
  if (sma200 != null) {
    signals.push(
      price >= sma200
        ? { tone: 'bullish', label: 'Above 200-day average', detail: 'The long-term trend is up.' }
        : { tone: 'bearish', label: 'Below 200-day average', detail: 'The long-term trend is down.' },
    );
  }

  const sma50 = ind.sma50[i];
  if (sma50 != null) {
    signals.push(
      price >= sma50
        ? { tone: 'bullish', label: 'Above 50-day average', detail: 'The medium-term trend is up.' }
        : { tone: 'bearish', label: 'Below 50-day average', detail: 'The medium-term trend is down.' },
    );
  }

  const averagesCross = recentCross(ind.sma50, ind.sma200, 10);
  if (averagesCross === 'up') {
    signals.push({ tone: 'bullish', label: 'Golden cross', detail: 'The 50-day average crossed above the 200-day average in the last 10 sessions.' });
  } else if (averagesCross === 'down') {
    signals.push({ tone: 'bearish', label: 'Death cross', detail: 'The 50-day average crossed below the 200-day average in the last 10 sessions.' });
  }

  const rsi = ind.rsi[i];
  if (rsi != null) {
    const value = rsi.toFixed(0);
    if (rsi > 70) {
      signals.push({ tone: 'bearish', label: `RSI ${value}: overbought`, detail: 'Strong recent gains; prices often pause or pull back from here.' });
    } else if (rsi < 30) {
      signals.push({ tone: 'bullish', label: `RSI ${value}: oversold`, detail: 'Heavy recent selling; prices often bounce from here.' });
    } else {
      signals.push({ tone: 'neutral', label: `RSI ${value}: neutral`, detail: 'Neither overbought (above 70) nor oversold (below 30).' });
    }
  }

  const macdValue = ind.macd.macd[i];
  const signalValue = ind.macd.signal[i];
  if (macdValue != null && signalValue != null) {
    const cross = recentCross(ind.macd.macd, ind.macd.signal, 5);
    signals.push(
      macdValue >= signalValue
        ? { tone: 'bullish', label: 'MACD above signal line', detail: cross === 'up' ? 'Momentum just turned up (crossed in the last 5 sessions).' : 'Short-term momentum is positive.' }
        : { tone: 'bearish', label: 'MACD below signal line', detail: cross === 'down' ? 'Momentum just turned down (crossed in the last 5 sessions).' : 'Short-term momentum is negative.' },
    );
  }

  return signals;
}
