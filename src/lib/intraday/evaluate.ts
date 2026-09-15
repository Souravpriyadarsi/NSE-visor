import { maxDrawdown, tStat } from '../stats.ts';
import type { PreparedBars } from './indicators.ts';
import type { RiskLimits } from './risk.ts';
import { simulate, type DayResult, type Trade } from './simulator.ts';
import type { Strategy, StrategyId, StrategyParams } from './strategies.ts';

export type TradeStats = {
  sessions: number;
  trades: number;
  wins: number;
  winRate: number | null;
  net: number;
  /** Net profit as a share of capital. */
  netPct: number;
  charges: number;
  /** Money made on winning trades divided by money lost on losing ones (null when nothing was lost). */
  profitFactor: number | null;
  avgR: number | null;
  /** Largest fall in capital from a peak, as a fraction. */
  maxDrawdown: number;
  /** How far the average trade is from zero, in standard errors. Below 2 could easily be luck. */
  tStat: number;
  positiveDays: number;
};

export function tradeStats(trades: Trade[], days: DayResult[], capital: number): TradeStats {
  const nets = trades.map((t) => t.net);
  const won = nets.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const lost = -nets.filter((n) => n < 0).reduce((a, b) => a + b, 0);
  const net = nets.reduce((a, b) => a + b, 0);
  const curve = [capital];
  for (const n of nets) curve.push(curve[curve.length - 1] + n);
  return {
    sessions: days.length,
    trades: trades.length,
    wins: nets.filter((n) => n > 0).length,
    winRate: trades.length ? nets.filter((n) => n > 0).length / trades.length : null,
    net,
    netPct: net / capital,
    charges: trades.reduce((sum, t) => sum + t.charges, 0),
    profitFactor: lost > 0 ? won / lost : null,
    avgR: trades.length ? trades.reduce((sum, t) => sum + t.r, 0) / trades.length : null,
    maxDrawdown: maxDrawdown(curve),
    tStat: tStat(nets),
    positiveDays: days.filter((d) => d.net > 0).length,
  };
}

/** Share of sessions used to choose settings; the rest are the unseen test. */
export const TRAIN_FRACTION = 2 / 3;
export const MIN_SESSIONS = 30;
export const MIN_TRAIN_TRADES = 5;
export const MIN_TEST_TRADES = 15;
export const MIN_PROFIT_FACTOR = 1.1;

export type WalkForwardResult = {
  strategy: StrategyId;
  params: StrategyParams;
  /** First session of the unseen test period. */
  testFrom: string;
  train: TradeStats;
  test: TradeStats;
  pass: boolean;
  /** Why it failed, in plain English. */
  reasons: string[];
  trainTrades: Trade[];
  testTrades: Trade[];
  days: DayResult[];
};

/**
 * Picks the settings that made the most on the first two-thirds of sessions, then scores them on the rest, which
 * played no part in the choice. Passing needs a profit after charges on those unseen days, enough trades and a
 * profit factor above MIN_PROFIT_FACTOR.
 */
export function walkForward(data: PreparedBars, strategy: Strategy, risk: RiskLimits): WalkForwardResult | null {
  const count = data.sessions.length;
  if (count < MIN_SESSIONS) return null;
  const split = Math.round(count * TRAIN_FRACTION);

  let best: { params: StrategyParams; score: number; result: ReturnType<typeof simulate> } | null = null;
  for (const params of strategy.grid) {
    const result = simulate(data, strategy, params, risk, { lastSession: split });
    const score = result.trades.length >= MIN_TRAIN_TRADES ? result.trades.reduce((sum, t) => sum + t.net, 0) : -Infinity;
    if (!best || score > best.score) best = { params, score, result };
  }
  const chosen = best!;
  const test = simulate(data, strategy, chosen.params, risk, { firstSession: split });
  const trainStats = tradeStats(chosen.result.trades, chosen.result.days, risk.capital);
  const testStats = tradeStats(test.trades, test.days, risk.capital);

  const reasons: string[] = [];
  if (testStats.net <= 0) reasons.push('Lost money after charges on the unseen days');
  if (testStats.trades < MIN_TEST_TRADES) reasons.push(`Only ${testStats.trades} trades on the unseen days (needs ${MIN_TEST_TRADES})`);
  if (testStats.trades > 0 && (testStats.profitFactor ?? Infinity) <= MIN_PROFIT_FACTOR) {
    reasons.push(`Profit factor ${testStats.profitFactor!.toFixed(2)} on the unseen days (needs above ${MIN_PROFIT_FACTOR})`);
  }

  return {
    strategy: strategy.id,
    params: chosen.params,
    testFrom: data.sessions[split].date,
    train: trainStats,
    test: testStats,
    pass: reasons.length === 0,
    reasons,
    trainTrades: chosen.result.trades,
    testTrades: test.trades,
    days: [...chosen.result.days, ...test.days],
  };
}

/** public/research/intraday.json */
export type IntradayResearch = {
  generatedAt: string;
  interval: '5m';
  risk: RiskLimits;
  stocks: {
    symbol: string;
    name: string;
    sessions: number;
    firstDate: string;
    lastDate: string;
    testFrom: string | null;
    results: Partial<Record<StrategyId, Pick<WalkForwardResult, 'params' | 'train' | 'test' | 'pass' | 'reasons'>>>;
  }[];
};

export function confidenceNote(stats: TradeStats): string {
  const t = Math.abs(stats.tStat);
  if (stats.trades < 10) return 'Too few trades to judge.';
  if (t < 1) return 'The result could easily be luck.';
  if (t < 2) return 'Weak evidence either way.';
  return stats.tStat > 0 ? 'Fairly strong evidence of an edge.' : 'Fairly strong evidence it loses money.';
}
