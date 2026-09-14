import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../types.ts';
import { analyze, modelPrices, summarize } from './analyze.ts';

const row = (date: string, close: number, adjClose = close): Row => [date, close, close, close, close, adjClose, 1000];

describe('modelPrices', () => {
  it('removes unadjusted split or demerger gaps and ends at the latest close', () => {
    const prices = modelPrices([row('2026-01-01', 100), row('2026-01-02', 102), row('2026-01-05', 50), row('2026-01-06', 51)]);
    expect(prices[3]).toBeCloseTo(51);
    expect(prices[2] / prices[1]).toBeCloseTo(1);
    expect(prices[1] / prices[0]).toBeCloseTo(1.02);
    expect(prices[3] / prices[2]).toBeCloseTo(1.02);
  });

  it('follows dividend-adjusted returns', () => {
    const prices = modelPrices([row('2026-01-01', 100, 90), row('2026-01-02', 110, 99)]);
    expect(prices[0]).toBeCloseTo(100);
    expect(prices[1]).toBeCloseTo(110);
  });
});

describe('analyze', () => {
  it('produces indicators, signals, a backtest and a forecast for a long history', () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(`day-${i}`, 100 * Math.exp(0.001 * i + 0.03 * Math.sin(i / 5))));
    const history: HistoryFile = { symbol: 'TEST.NS', name: 'Test', updatedAt: '', lastDate: '2026-09-11', rows };
    const result = analyze(history);
    expect(result.indicators.rsi).toHaveLength(500);
    expect(result.signals.length).toBeGreaterThanOrEqual(4);
    expect(result.backtest).not.toBeNull();
    expect(result.forecast?.dates[0]).toBe('2026-09-14');
    expect(analyze(history)).toBe(result);

    const summary = summarize(history);
    const last = rows[rows.length - 1][4];
    expect(summary.lastClose).toBe(last);
    expect(summary.dayChange).toBeCloseTo(last / rows[rows.length - 2][4] - 1);
    expect(summary.predicted).toBe(result.forecast?.mid.at(-1));
    expect(summary.expectedChange).toBeCloseTo(summary.predicted! / last - 1);
  });

  it('summarizes short histories without a forecast', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`day-${i}`, 100 + i));
    const summary = summarize({ symbol: 'NEW.NS', name: 'New', updatedAt: '', lastDate: '2026-09-11', rows });
    expect(summary.predicted).toBeNull();
    expect(summary.expectedChange).toBeNull();
    expect(summary.probUp).toBeNull();
  });
});
