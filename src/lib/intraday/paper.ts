import type { IntradayHistory } from './bars.ts';
import { prepareBars, type PreparedBars } from './indicators.ts';
import { DEFAULT_RISK, type RiskLimits } from './risk.ts';
import { simulate, type ActiveWindow, type SimulationResult } from './simulator.ts';
import { STRATEGIES, strategyById, type StrategyId, type StrategyParams } from './strategies.ts';

export const MAX_PAPER_STOCKS = 5;
/** Paper trading days to see before considering real money. */
export const PAPER_MIN_DAYS = 20;

export type PaperSettings = {
  symbols: string[];
  strategy: StrategyId;
  /** Split equally between the stocks. */
  capital: number;
  riskPerTrade: number;
  allowShort: boolean;
  /** Each stock's strategy settings, taken from the nightly research when trading starts. */
  params: Record<string, StrategyParams>;
};

export type PaperDay = {
  date: string;
  strategy: StrategyId;
  symbols: string[];
  capital: number;
  trades: number;
  wins: number;
  net: number;
  charges: number;
};

/** Everything the paper trader keeps in the browser. Trades aren't stored: they're replayed from prices and the on/off times. */
export type PaperState = { settings: PaperSettings; windows: ActiveWindow[]; record: PaperDay[] };

export const DEFAULT_PAPER_STATE: PaperState = {
  settings: { symbols: [], strategy: 'orb', capital: 100_000, riskPerTrade: DEFAULT_RISK.riskPerTrade, allowShort: true, params: {} },
  windows: [],
  record: [],
};

export function parsePaperState(stored: unknown): PaperState | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { settings, windows, record } = stored as Partial<PaperState>;
  if (
    !settings ||
    !Array.isArray(settings.symbols) ||
    !STRATEGIES.some((s) => s.id === settings.strategy) ||
    typeof settings.capital !== 'number' ||
    typeof settings.riskPerTrade !== 'number'
  ) {
    return null;
  }
  return {
    settings: { ...DEFAULT_PAPER_STATE.settings, ...settings },
    windows: Array.isArray(windows) ? windows.filter((w) => typeof w?.from === 'number') : [],
    record: Array.isArray(record) ? record.filter((r) => typeof r?.date === 'string' && typeof r.net === 'number') : [],
  };
}

/** Each stock trades an equal share of the capital, and the risk limits apply to that share. */
export function paperRisk(settings: PaperSettings): RiskLimits {
  return {
    ...DEFAULT_RISK,
    capital: settings.capital / Math.max(1, settings.symbols.length),
    riskPerTrade: settings.riskPerTrade,
    allowShort: settings.allowShort,
  };
}

export type PaperDayResult = { data: PreparedBars; session: number; result: SimulationResult };

/**
 * One stock's trading day, replayed from its bars exactly like the backtest but only trading while the trader was on.
 * Because it's a replay, a page refresh picks up exactly where it left off.
 */
export function paperDay(
  history: IntradayHistory,
  date: string,
  settings: PaperSettings,
  windows: ActiveWindow[],
  live: boolean,
): PaperDayResult | null {
  const session = history.sessions.findIndex((s) => s.date === date);
  if (session < 0) return null;
  const data = prepareBars({ ...history, sessions: history.sessions.slice(0, session + 1) });
  const strategy = strategyById(settings.strategy);
  const params = settings.params[history.symbol] ?? strategy.grid[0];
  return { data, session, result: simulate(data, strategy, params, paperRisk(settings), { firstSession: session, windows, live }) };
}

export function summarizeDay(date: string, settings: PaperSettings, results: SimulationResult[]): PaperDay {
  const trades = results.flatMap((r) => r.trades);
  return {
    date,
    strategy: settings.strategy,
    symbols: settings.symbols,
    capital: settings.capital,
    trades: trades.length,
    wins: trades.filter((t) => t.net > 0).length,
    net: trades.reduce((sum, t) => sum + t.net, 0),
    charges: trades.reduce((sum, t) => sum + t.charges, 0),
  };
}
