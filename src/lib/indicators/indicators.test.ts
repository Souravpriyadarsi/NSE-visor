import { describe, expect, it } from 'vitest';
import { ema, macd, rsi, sma } from './indicators.ts';
import { recentCross } from './signals.ts';

const oneToTen = Array.from({ length: 10 }, (_, i) => i + 1);

describe('indicators', () => {
  it('computes a simple moving average', () => {
    expect(sma(oneToTen, 3)).toEqual([null, null, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('computes an EMA seeded with the SMA', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('gives RSI 100 for a steadily rising series and 50 for a flat one', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(rising).at(-1)).toBe(100);
    expect(rsi(new Array(30).fill(100)).at(-1)).toBe(50);
    expect(rsi(rising)[13]).toBeNull();
  });

  it('computes MACD aligned with the input', () => {
    const flat = new Array(60).fill(250);
    const result = macd(flat);
    expect(result.macd).toHaveLength(60);
    expect(result.macd[24]).toBeNull();
    expect(result.macd[25]).toBe(0);
    expect(result.signal[32]).toBeNull();
    expect(result.signal[33]).toBe(0);
    expect(result.histogram.at(-1)).toBe(0);
  });

  it('detects a recent cross', () => {
    const a = [1, 1, 1, 3];
    const b = [2, 2, 2, 2];
    expect(recentCross(a, b, 2)).toBe('up');
    expect(recentCross(b, a, 2)).toBe('down');
    expect(recentCross([1, 3, 3, 3], b, 2)).toBeNull();
  });
});
