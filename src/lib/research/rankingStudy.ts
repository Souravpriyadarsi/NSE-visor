import { maxDrawdown, mean, spearman, std, tStat } from '../stats.ts';
import type { Market, StockSeries } from './series.ts';
import { RANK_SIGNALS, rankScores, signalValues, type RankKey, type SignalDefinition, type SignalKey } from './signals.ts';

const MIN_STOCKS = 20;

export type SignalMonth = { ic: number; gross: number; net: number; turnover: number };

export type MonthResult = {
  date: string;
  nextDate: string;
  holdout: boolean;
  bull: boolean | null;
  vix: number | null;
  stocks: number;
  /** Equal-weight return of every eligible stock. */
  universe: number;
  nifty: number | null;
  signals: Record<RankKey, SignalMonth>;
};

/**
 * Each month-end: score every stock using data up to that day, "buy" the top share of each ranking (equal weight),
 * and measure the next month's return, less the round-trip cost on the stocks that changed.
 */
export function rankingMonths(series: StockSeries[], market: Market, costRoundTrip: number, topShare: number): MonthResult[] {
  const results: MonthResult[] = [];
  const previous = new Map<RankKey, Set<string>>();
  const { nifty } = market;

  for (let k = 0; k + 1 < market.origins.length; k++) {
    const origin = market.origins[k];
    const nextDate = market.origins[k + 1].date;
    const rows: { symbol: string; values: Record<SignalKey, number>; forward: number }[] = [];
    for (const s of series) {
      const i0 = s.index.get(origin.date);
      const i1 = s.index.get(nextDate);
      if (i0 === undefined || i1 === undefined) continue;
      const values = signalValues(s.prices, i0);
      if (values) rows.push({ symbol: s.symbol, values, forward: s.prices[i1] / s.prices[i0] - 1 });
    }
    if (rows.length < MIN_STOCKS) continue;

    const scores = rankScores(rows.map((r) => r.values));
    const forward = rows.map((r) => r.forward);
    const topCount = Math.max(1, Math.round(rows.length * topShare));
    const signals = {} as Record<RankKey, SignalMonth>;
    for (const { key } of RANK_SIGNALS) {
      const score = scores.map((s) => s[key]);
      const top = score
        .map((_, n) => n)
        .sort((a, b) => score[b] - score[a])
        .slice(0, topCount);
      const holdings = new Set(top.map((n) => rows[n].symbol));
      const before = previous.get(key);
      const turnover = before ? 1 - [...holdings].filter((h) => before.has(h)).length / holdings.size : 1;
      const gross = mean(top.map((n) => forward[n]));
      signals[key] = { ic: spearman(score, forward), gross, net: gross - turnover * costRoundTrip, turnover };
      previous.set(key, holdings);
    }

    const n0 = nifty.index.get(origin.date);
    const n1 = nifty.index.get(nextDate);
    results.push({
      date: origin.date,
      nextDate,
      holdout: nextDate > market.holdoutStart,
      bull: origin.bull,
      vix: origin.vix,
      stocks: rows.length,
      universe: mean(forward),
      nifty: n0 === undefined || n1 === undefined ? null : nifty.prices[n1] / nifty.prices[n0] - 1,
      signals,
    });
  }
  return results;
}

export type PeriodResult = {
  /** Average monthly rank correlation between the signal and next month's return. */
  meanIc: number;
  icT: number;
  positiveShare: number;
  months: number;
  /** Top-share portfolio after costs. */
  cagr: number;
  volatility: number;
  sharpe: number;
  maxDrawdown: number;
  beatUniverseShare: number;
  turnover: number;
  universeCagr: number;
  niftyCagr: number | null;
};

export type RegimeExcess = { months: number; excess: number | null };
export type SignalStatus = 'confirmed' | 'failedHoldout' | 'failed';

export type SignalSummary = SignalDefinition & {
  status: SignalStatus;
  dev: PeriodResult | null;
  holdout: PeriodResult | null;
  /** Average monthly return of the top share above the universe, after costs, by market condition. */
  regimes: { bull: RegimeExcess; bear: RegimeExcess; calm: RegimeExcess; turbulent: RegimeExcess };
};

const annualized = (monthly: number[]) => Math.exp((monthly.reduce((sum, r) => sum + Math.log1p(r), 0) * 12) / monthly.length) - 1;

function growth(monthly: number[]): number[] {
  const curve = [1];
  for (const r of monthly) curve.push(curve[curve.length - 1] * (1 + r));
  return curve;
}

export function periodResult(months: MonthResult[], key: RankKey, riskFreeRate: number): PeriodResult | null {
  if (months.length < 2) return null;
  const net = months.map((m) => m.signals[key].net);
  const ics = months.map((m) => m.signals[key].ic);
  const nifty = months.map((m) => m.nifty);
  const spread = std(net);
  return {
    meanIc: mean(ics),
    icT: tStat(ics),
    positiveShare: ics.filter((ic) => ic > 0).length / ics.length,
    months: months.length,
    cagr: annualized(net),
    volatility: spread * Math.sqrt(12),
    sharpe: spread > 0 ? ((mean(net) - riskFreeRate / 12) / spread) * Math.sqrt(12) : 0,
    maxDrawdown: maxDrawdown(growth(net)),
    beatUniverseShare: months.filter((m) => m.signals[key].net > m.universe).length / months.length,
    turnover: mean(months.map((m) => m.signals[key].turnover)),
    universeCagr: annualized(months.map((m) => m.universe)),
    niftyCagr: nifty.every((v): v is number => v != null) ? annualized(nifty) : null,
  };
}

/**
 * Rules fixed before testing. Passing the development years needs a positive average rank correlation that is
 * statistically meaningful (t of 2+), positive in 55%+ of months, and a top-share portfolio beating the average
 * stock after costs. "Confirmed" also needs both to hold in the sealed test period.
 */
export function signalStatus(dev: PeriodResult | null, holdout: PeriodResult | null): SignalStatus {
  const devPass = dev != null && dev.meanIc > 0 && dev.icT >= 2 && dev.positiveShare >= 0.55 && dev.cagr > dev.universeCagr;
  if (!devPass) return 'failed';
  return holdout != null && holdout.meanIc > 0 && holdout.cagr > holdout.universeCagr ? 'confirmed' : 'failedHoldout';
}

export function summarizeSignals(months: MonthResult[], riskFreeRate: number, vixMedian: number | null): SignalSummary[] {
  const devMonths = months.filter((m) => !m.holdout);
  const holdoutMonths = months.filter((m) => m.holdout);
  return RANK_SIGNALS.map(({ key, label, description }) => {
    const dev = periodResult(devMonths, key, riskFreeRate);
    const holdout = periodResult(holdoutMonths, key, riskFreeRate);
    const excess = (subset: MonthResult[]): RegimeExcess => ({
      months: subset.length,
      excess: subset.length ? mean(subset.map((m) => m.signals[key].net - m.universe)) : null,
    });
    const withVix = vixMedian == null ? [] : months.filter((m) => m.vix != null);
    return {
      key,
      label,
      description,
      status: signalStatus(dev, holdout),
      dev,
      holdout,
      regimes: {
        bull: excess(months.filter((m) => m.bull === true)),
        bear: excess(months.filter((m) => m.bull === false)),
        calm: excess(withVix.filter((m) => m.vix! <= vixMedian!)),
        turbulent: excess(withVix.filter((m) => m.vix! > vixMedian!)),
      },
    };
  });
}

export type RankingCurve = { dates: string[]; universe: number[]; nifty: number[]; series: Record<RankKey, number[]> };

const round4 = (curve: number[]) => curve.map((v) => Number(v.toFixed(4)));

/** Growth of 1 invested at the first month-end: each ranking's top share after costs, the average stock and NIFTY 50. */
export function rankingCurve(months: MonthResult[]): RankingCurve {
  return {
    dates: months.length ? [months[0].date, ...months.map((m) => m.nextDate)] : [],
    universe: round4(growth(months.map((m) => m.universe))),
    nifty: round4(growth(months.map((m) => m.nifty ?? 0))),
    series: Object.fromEntries(RANK_SIGNALS.map(({ key }) => [key, round4(growth(months.map((m) => m.signals[key].net)))])) as Record<RankKey, number[]>,
  };
}
