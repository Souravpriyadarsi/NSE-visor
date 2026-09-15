import { ema } from '../indicators/indicators.ts';
import { INTERVAL_SECONDS, istMinute, type IntradayBar, type IntradayHistory, type IntradaySession } from './bars.ts';

/** All sessions' bars in one run, with the indicators the strategies read. Every value at index i uses bars up to i only. */
export type PreparedBars = {
  symbol: string;
  sessions: IntradaySession[];
  bars: IntradayBar[];
  barSeconds: number;
  /** Session index of each bar. */
  session: number[];
  /** Index of each session's first bar (plus one past the end). */
  sessionStart: number[];
  minute: number[];
  close: number[];
  /** Volume-weighted average price since the day's open. */
  vwap: number[];
  /** Average true range over 14 bars (Wilder); null until there are 14 bars. */
  atr: (number | null)[];
  ema: (period: number) => (number | null)[];
};

export const ATR_PERIOD = 14;

export function prepareBars(history: IntradayHistory): PreparedBars {
  const bars: IntradayBar[] = [];
  const session: number[] = [];
  const sessionStart: number[] = [];
  history.sessions.forEach((s, index) => {
    sessionStart.push(bars.length);
    for (const bar of s.bars) {
      bars.push(bar);
      session.push(index);
    }
  });
  sessionStart.push(bars.length);

  const close = bars.map((bar) => bar[4]);
  const minute = bars.map((bar) => istMinute(bar[0]));

  const vwap: number[] = [];
  let priceVolume = 0;
  let volume = 0;
  let priceSum = 0;
  let count = 0;
  bars.forEach((bar, i) => {
    if (i === sessionStart[session[i]]) priceVolume = volume = priceSum = count = 0;
    const typical = (bar[2] + bar[3] + bar[4]) / 3;
    priceVolume += typical * bar[5];
    volume += bar[5];
    priceSum += typical;
    count++;
    vwap.push(volume > 0 ? priceVolume / volume : priceSum / count);
  });

  // A day's first bar uses its own high-low range, so the overnight gap doesn't inflate the ATR.
  const atr: (number | null)[] = [];
  let average = 0;
  bars.forEach((bar, i) => {
    const firstOfDay = i === sessionStart[session[i]];
    const previous = close[i - 1];
    const range = firstOfDay ? bar[2] - bar[3] : Math.max(bar[2] - bar[3], Math.abs(bar[2] - previous), Math.abs(bar[3] - previous));
    if (i < ATR_PERIOD) {
      average += range / ATR_PERIOD;
      atr.push(i === ATR_PERIOD - 1 ? average : null);
    } else {
      average = (average * (ATR_PERIOD - 1) + range) / ATR_PERIOD;
      atr.push(average);
    }
  });

  const emas = new Map<number, (number | null)[]>();
  return {
    symbol: history.symbol,
    sessions: history.sessions,
    bars,
    barSeconds: INTERVAL_SECONDS[history.interval],
    session,
    sessionStart,
    minute,
    close,
    vwap,
    atr,
    ema(period) {
      let series = emas.get(period);
      if (!series) emas.set(period, (series = ema(close, period)));
      return series;
    },
  };
}
