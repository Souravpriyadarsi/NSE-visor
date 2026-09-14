import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../types.ts';
import { nextTradingDays } from './dates.ts';
import { buildTracker, makeSnapshot, matchActual, scorePredictions, type Snapshot } from './tracker.ts';

function history(symbol: string, closes: number[], firstDate = '2026-01-01'): HistoryFile {
  const dates = [firstDate, ...nextTradingDays(firstDate, closes.length - 1)];
  const rows: Row[] = closes.map((c, i) => [dates[i], c, c, c, c, c, 1000]);
  return { symbol, name: `${symbol} Ltd`, updatedAt: '', lastDate: dates[dates.length - 1], rows };
}

const flatPath = (value: number) => new Array<number>(22).fill(value);

describe('matchActual', () => {
  const h = history('A.NS', Array.from({ length: 40 }, (_, i) => 100 + i));

  it('finds the close 22 trading days later', () => {
    const madeOn = h.rows[5][0];
    const result = matchActual(h.rows, madeOn);
    expect(result.actual).toEqual({ date: h.rows[27][0], close: 127 });
    expect(result.elapsed).toBe(22);
  });

  it('reports progress for predictions that have not matured', () => {
    const madeOn = h.rows[30][0];
    expect(matchActual(h.rows, madeOn)).toEqual({ actual: null, elapsed: 9, latest: 139 });
  });

  it('handles unknown dates', () => {
    expect(matchActual(h.rows, '1999-01-01')).toEqual({ actual: null, elapsed: 0, latest: null });
  });
});

describe('scorePredictions', () => {
  it('scores only matured predictions', () => {
    const score = scorePredictions([
      { close: 100, predicted: 110, low: 95, high: 120, actual: 100 },
      { close: 100, predicted: 90, low: 85, high: 99, actual: 80 },
      { close: 100, predicted: 105, low: 90, high: 120, actual: null },
    ]);
    expect(score.matured).toBe(2);
    expect(score.avgError).toBeCloseTo((0.1 + 0.125) / 2);
    expect(score.directionHits).toBe(1);
    expect(score.insideRange).toBe(1);
  });

  it('returns no error when nothing has matured', () => {
    expect(scorePredictions([]).avgError).toBeNull();
  });
});

describe('makeSnapshot and buildTracker', () => {
  it('saves forecasts and later lines them up with actual prices', () => {
    const closes = Array.from({ length: 500 }, (_, i) => 100 * Math.exp(0.001 * i + 0.02 * Math.sin(i / 7)));
    const early = history('A.NS', closes.slice(0, 450));
    const snapshot = makeSnapshot([early], new Date('2026-01-01T12:00:00Z'));
    expect(snapshot.date).toBe(early.lastDate);
    expect(snapshot.stocks[0].mid).toHaveLength(22);

    const pending: Snapshot = {
      date: '2099-01-01',
      savedAt: '',
      stocks: [{ symbol: 'A.NS', name: 'A Ltd', asOf: 'not-a-trading-day', close: 1, mid: flatPath(1), low: flatPath(1), high: flatPath(1) }],
    };
    const later = history('A.NS', closes);
    const { index, stocks, sheets } = buildTracker([pending, snapshot], new Map([['A.NS', later]]), new Date());

    expect(index.dates).toEqual([snapshot.date, '2099-01-01']);
    expect(sheets[0].rows[0].actual).toBe(later.rows[449 + 22][4]);
    expect(sheets[1].rows[0].actual).toBeNull();
    expect(stocks[0].predictions).toHaveLength(2);
    expect(stocks[0].actual[0][0]).toBe(later.rows[449 - 22][0]);
    expect(index.score.matured).toBe(1);
  });
});
