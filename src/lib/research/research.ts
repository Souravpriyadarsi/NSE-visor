import type { HistoryFile } from '../../types.ts';
import { percentile, percentileRanks, windowMean } from '../stats.ts';
import {
  accuracyByRegime,
  accuracyByYear,
  calibratedRangeScale,
  forecastRecords,
  summarizeForecasts,
  trustFor,
  type ForecastRecord,
  type ForecastSummary,
  type RegimeAccuracy,
  type Trust,
  type YearAccuracy,
} from './forecastStudy.ts';
import {
  rankingCurve,
  rankingMonths,
  summarizeSignals,
  type RankingCurve,
  type RegimeExcess,
  type SignalStatus,
  type SignalSummary,
} from './rankingStudy.ts';
import { buildMarket, toSeries } from './series.ts';
import { COMPOSITE, rankScores, SIGNALS, signalValues, type RankKey, type SignalKey } from './signals.ts';

export type ResearchSettings = {
  /** Outcomes in the last this-many months form the sealed test period. */
  holdoutMonths: number;
  /** Round-trip cost per stock replaced: STT, brokerage, stamp duty, exchange fees and slippage. */
  costRoundTrip: number;
  riskFreeRate: number;
  /** Share of top-ranked stocks each test portfolio holds. */
  topShare: number;
  /** Trading days of history a stock needs before it is forecast. */
  minHistory: number;
  simulationPaths: number;
  /** Monthly forecasts a stock needs before it gets a trust grade. */
  trustMinMonths: number;
};

export const RESEARCH_SETTINGS: ResearchSettings = {
  holdoutMonths: 24,
  costRoundTrip: 0.004,
  riskFreeRate: 0.065,
  topShare: 0.2,
  minHistory: 504,
  simulationPaths: 400,
  trustMinMonths: 24,
};

/** public/research/report.json: everything on the Model Report page. */
export type ResearchReport = {
  generatedAt: string;
  universe: { name: string; stocks: number };
  settings: ResearchSettings;
  period: { from: string; to: string; holdoutStart: string };
  forecasts: {
    rangeScale: number;
    dev: ForecastSummary | null;
    holdout: ForecastSummary | null;
    byYear: YearAccuracy[];
    byRegime: { bull: RegimeAccuracy; bear: RegimeAccuracy };
  };
  ranking: { signals: SignalSummary[]; curve: RankingCurve; vixMedian: number | null };
};

export type MarketRegime = {
  niftyClose: number;
  niftySma200: number | null;
  /** NIFTY 50 above its 200-day average. */
  bull: boolean | null;
  vix: number | null;
  vixMedian: number | null;
  vixHigh: boolean | null;
  /** How the ranking signal's top stocks did against the average stock, per month after costs, in each NIFTY condition. */
  rankedExcess: { bull: RegimeExcess; bear: RegimeExcess };
};

export type StockScore = {
  /** 1 = best on the ranking signal today. */
  rank: number | null;
  of: number;
  signals: Partial<Record<SignalKey, { value: number; percentile: number }>>;
  trust: Trust;
};

/** public/research/scores.json: today's ranks, signals and trust grades, used by the Dashboard and Analyze. */
export type ResearchScores = {
  generatedAt: string;
  asOf: string;
  rangeScale: number;
  regime: MarketRegime;
  /** The signal behind each stock's rank: the confirmed signal with the strongest development result, else the composite. */
  rankSignal: { key: RankKey; label: string; status: SignalStatus };
  signals: { key: RankKey; label: string; status: SignalStatus }[];
  stocks: Record<string, StockScore>;
};

export type ResearchInput = {
  universeName: string;
  stocks: { history: HistoryFile; industry: string }[];
  nifty: HistoryFile;
  vix: HistoryFile | null;
  now: Date;
};

const round = (value: number) => Number(value.toFixed(4));

export function runResearch(
  input: ResearchInput,
  settings: ResearchSettings = RESEARCH_SETTINGS,
  onProgress?: (done: number, total: number) => void,
): { report: ResearchReport; scores: ResearchScores } {
  const series = input.stocks.map((s) => toSeries(s.history, s.industry));
  const vixCloses = input.vix ? new Map(input.vix.rows.map((row) => [row[0], row[4]])) : null;
  const market = buildMarket(toSeries(input.nifty), vixCloses, settings.holdoutMonths);

  // 1. How accurate the forecasts and ranges have been.
  const recordsBySymbol = new Map<string, ForecastRecord[]>();
  series.forEach((s, n) => {
    recordsBySymbol.set(s.symbol, forecastRecords(s, market, settings.simulationPaths, settings.minHistory));
    onProgress?.(n + 1, series.length);
  });
  const records = [...recordsBySymbol.values()].flat();
  const dev = records.filter((r) => !r.holdout);
  const rangeScale = calibratedRangeScale(dev);
  const devUpRate = dev.length ? dev.filter((r) => r.actual > r.start).length / dev.length : 0.5;

  // 2. Which ranking signals have worked.
  const months = rankingMonths(series, market, settings.costRoundTrip, settings.topShare);
  const devVix = market.origins
    .filter((o) => o.date <= market.holdoutStart && o.vix != null)
    .map((o) => o.vix!)
    .sort((a, b) => a - b);
  const vixMedian = devVix.length ? percentile(devVix, 0.5) : null;
  const signals = summarizeSignals(months, settings.riskFreeRate, vixMedian);

  const report: ResearchReport = {
    generatedAt: input.now.toISOString(),
    universe: { name: input.universeName, stocks: series.length },
    settings,
    period: {
      from: [...records.map((r) => r.date), ...months.map((m) => m.date)].sort()[0] ?? market.latestDate,
      to: market.latestDate,
      holdoutStart: market.holdoutStart,
    },
    forecasts: {
      rangeScale,
      dev: summarizeForecasts(dev, rangeScale, devUpRate),
      holdout: summarizeForecasts(
        records.filter((r) => r.holdout),
        rangeScale,
        devUpRate,
      ),
      byYear: accuracyByYear(records),
      byRegime: accuracyByRegime(records),
    },
    ranking: { signals, curve: rankingCurve(months), vixMedian },
  };

  // 3. Today's scores for each stock.
  const latest = series.flatMap((s) => {
    const i = s.index.get(market.latestDate);
    const values = i === undefined ? null : signalValues(s.prices, i);
    return values ? [{ symbol: s.symbol, values }] : [];
  });
  // Fixed rule: rank by the confirmed signal with the strongest development result, or the pre-chosen composite if none is confirmed.
  const rankSignal =
    signals.filter((s) => s.status === 'confirmed').sort((a, b) => (b.dev?.icT ?? 0) - (a.dev?.icT ?? 0))[0] ??
    signals.find((s) => s.key === COMPOSITE.key)!;
  const rankValues = rankScores(latest.map((l) => l.values)).map((s) => s[rankSignal.key]);
  const percentiles = Object.fromEntries(
    SIGNALS.map(({ key }) => [key, percentileRanks(latest.map((l) => l.values[key]))]),
  ) as Record<SignalKey, number[]>;
  const position = new Map(
    latest
      .map((_, n) => n)
      .sort((a, b) => rankValues[b] - rankValues[a])
      .map((n, r) => [latest[n].symbol, { n, rank: r + 1 }] as const),
  );

  const stocks: Record<string, StockScore> = {};
  for (const s of series) {
    const found = position.get(s.symbol);
    stocks[s.symbol] = {
      rank: found?.rank ?? null,
      of: latest.length,
      signals: found
        ? (Object.fromEntries(
            SIGNALS.map(({ key }) => [key, { value: round(latest[found.n].values[key]), percentile: round(percentiles[key][found.n]) }]),
          ) as StockScore['signals'])
        : {},
      trust: trustFor(recordsBySymbol.get(s.symbol) ?? [], rangeScale, settings.trustMinMonths),
    };
  }

  const closes = input.nifty.rows.map((row) => row[4]);
  const niftyClose = closes[closes.length - 1];
  const niftySma200 = closes.length >= 200 ? windowMean(closes, closes.length - 200, closes.length - 1) : null;
  const vix = input.vix ? input.vix.rows[input.vix.rows.length - 1][4] : null;

  const scores: ResearchScores = {
    generatedAt: report.generatedAt,
    asOf: market.latestDate,
    rangeScale,
    regime: {
      niftyClose,
      niftySma200,
      bull: niftySma200 == null ? null : niftyClose > niftySma200,
      vix,
      vixMedian,
      vixHigh: vix == null || vixMedian == null ? null : vix > vixMedian,
      rankedExcess: { bull: rankSignal.regimes.bull, bear: rankSignal.regimes.bear },
    },
    rankSignal: { key: rankSignal.key, label: rankSignal.label, status: rankSignal.status },
    signals: signals.map(({ key, label, status }) => ({ key, label, status })),
    stocks,
  };
  return { report, scores };
}
