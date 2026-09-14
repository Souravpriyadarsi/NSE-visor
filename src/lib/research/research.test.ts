import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../../types.ts';
import { nextTradingDays } from '../dates.ts';
import { mulberry32, normal } from '../random.ts';
import { maxDrawdown, percentileRanks, spearman, tStat, wilson } from '../stats.ts';
import { forecastRecords } from './forecastStudy.ts';
import { runResearch, type ResearchSettings } from './research.ts';
import { buildMarket, monthEndIndices, toSeries } from './series.ts';
import { signalValues } from './signals.ts';

function history(symbol: string, closes: number[]): HistoryFile {
  const dates = ['2018-01-01', ...nextTradingDays('2018-01-01', closes.length - 1)];
  const rows: Row[] = closes.map((c, i) => [dates[i], c, c, c, c, c, 1000]);
  return { symbol, name: symbol, updatedAt: '', lastDate: dates[dates.length - 1], rows };
}

function walk(length: number, drift: number, seed: number, volatility = 0.012): number[] {
  const random = mulberry32(seed);
  const prices = [100];
  for (let i = 1; i < length; i++) prices.push(prices[i - 1] * Math.exp(drift + volatility * normal(random)));
  return prices;
}

describe('ranking statistics', () => {
  it('computes rank correlation, percentile ranks, confidence intervals and drawdowns', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(percentileRanks([30, 10, 20, 20])).toEqual([1, 0, 0.5, 0.5]);
    const [low, high] = wilson(55, 100);
    expect(low).toBeGreaterThan(0.44);
    expect(low).toBeLessThan(0.55);
    expect(high).toBeGreaterThan(0.55);
    expect(tStat([1, 1, 1])).toBe(0);
    expect(tStat([0.9, 1.1, 1, 1])).toBeGreaterThan(10);
    expect(maxDrawdown([1, 1.2, 0.9, 1.3])).toBeCloseTo(0.25);
  });
});

describe('signals', () => {
  it('needs a year of history and measures momentum without the latest month', () => {
    const prices = Array.from({ length: 300 }, (_, t) => 100 * Math.exp(0.001 * t));
    expect(signalValues(prices, 251)).toBeNull();
    const values = signalValues(prices, 299)!;
    expect(values.momentum12).toBeCloseTo(Math.exp(0.001 * 231) - 1, 10);
    expect(values.reversal1m).toBeCloseTo(-(Math.exp(0.021) - 1), 10);
    expect(values.lowVolatility).toBeCloseTo(0, 6);
    expect(values.trend200).toBeGreaterThan(0);
  });

  it('finds month-ends', () => {
    expect(monthEndIndices(['2026-01-29', '2026-01-30', '2026-02-02', '2026-02-27', '2026-03-02'])).toEqual([1, 3]);
  });
});

describe('research backtest', () => {
  const count = 25;
  const length = 900;
  // Stocks with steadily different drifts, so 12-month momentum genuinely predicts next month.
  const stocks = Array.from({ length: count }, (_, s) => ({
    history: history(`S${s}.NS`, walk(length, -0.0008 + (0.0016 * s) / (count - 1), s + 1)),
    industry: 'Test',
  }));
  const nifty = history('^NSEI', walk(length, 0.0003, 999, 0.008));
  const settings: ResearchSettings = {
    holdoutMonths: 8,
    costRoundTrip: 0.004,
    riskFreeRate: 0.065,
    topShare: 0.2,
    minHistory: 504,
    simulationPaths: 40,
    trustMinMonths: 6,
  };
  const { report, scores } = runResearch({ universeName: 'Test', stocks, nifty, vix: null, now: new Date('2026-01-01') }, settings);

  it('only uses the past and labels outcomes in the sealed period', () => {
    const market = buildMarket(toSeries(nifty), null, settings.holdoutMonths);
    const series = toSeries(stocks[0].history);
    const records = forecastRecords(series, market, 20, settings.minHistory);
    expect(records.length).toBeGreaterThan(10);
    for (const r of records) {
      const i = series.index.get(r.date)!;
      expect(i + 1).toBeGreaterThanOrEqual(settings.minHistory);
      expect(r.start).toBe(series.prices[i]);
      expect(r.actual).toBe(series.prices[i + 22]);
      expect(r.holdout).toBe(series.dates[i + 22] > market.holdoutStart);
    }
    expect(records.some((r) => r.holdout)).toBe(true);
    expect(records.some((r) => !r.holdout)).toBe(true);
  });

  it('summarizes forecast accuracy and calibrates the range to about 80%', () => {
    const { dev, holdout, rangeScale } = report.forecasts;
    expect(holdout).not.toBeNull();
    expect(dev!.models.map((m) => m.key)).toEqual(['ensemble', 'trend', 'holt', 'gbm', 'baseline']);
    for (const m of dev!.models) {
      expect(m.error).toBeGreaterThan(0);
      expect(m.ci[0]).toBeLessThanOrEqual(m.hitRate);
      expect(m.ci[1]).toBeGreaterThanOrEqual(m.hitRate);
    }
    expect(rangeScale).toBeGreaterThan(0);
    expect(dev!.coverageCalibrated).toBeGreaterThanOrEqual(0.78);
    expect(dev!.coverageCalibrated).toBeLessThanOrEqual(0.85);
  });

  it('detects the planted momentum and ranks every stock', () => {
    const momentum = report.ranking.signals.find((s) => s.key === 'momentum12')!;
    expect(momentum.dev!.meanIc).toBeGreaterThan(0);
    expect(['confirmed', 'failedHoldout', 'failed']).toContain(momentum.status);
    expect(report.ranking.curve.dates).toHaveLength(report.ranking.curve.universe.length);

    const ranks = Object.values(scores.stocks)
      .map((s) => s.rank!)
      .sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: count }, (_, n) => n + 1));
    expect(Object.values(scores.stocks).every((s) => s.trust.grade !== 'unrated')).toBe(true);

    const confirmed = report.ranking.signals.filter((s) => s.status === 'confirmed');
    expect(scores.rankSignal.key).toBe(confirmed.length ? scores.rankSignal.key : 'composite');
    if (confirmed.length) expect(scores.rankSignal.status).toBe('confirmed');
  });
});
