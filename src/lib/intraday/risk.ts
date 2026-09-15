/** Limits every simulated, paper or (later) live trade must respect. */
export type RiskLimits = {
  capital: number;
  /** Largest loss if the stop is hit, as a share of capital. */
  riskPerTrade: number;
  /** Largest position value as a multiple of capital (1 = no leverage). */
  maxPositionFraction: number;
  maxTradesPerDay: number;
  /** Stop trading for the day and exit once the day's loss reaches this share of capital. */
  dailyLossLimit: number;
  /** No new entries from signals after this minute of the day (IST). */
  lastEntryMinute: number;
  /** Everything is closed at the close of the bar ending at this minute. */
  squareOffMinute: number;
  /** Assumed price disadvantage on each market order, as a fraction of the price. */
  slippage: number;
  allowShort: boolean;
};

export const DEFAULT_RISK: RiskLimits = {
  capital: 100_000,
  riskPerTrade: 0.005,
  maxPositionFraction: 1,
  maxTradesPerDay: 3,
  dailyLossLimit: 0.015,
  lastEntryMinute: 14 * 60 + 45,
  squareOffMinute: 15 * 60 + 15,
  slippage: 0.0003,
  allowShort: true,
};

export const RISK_PER_TRADE_CHOICES = [0.0025, 0.005, 0.01];

/** "0.25%" */
export const riskLabel = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;

/** Shares to trade so that hitting the stop loses about riskPerTrade of capital, capped by the position-value limit. */
export function positionSize(risk: RiskLimits, price: number, stop: number): number {
  const riskPerShare = Math.abs(price - stop);
  if (!(riskPerShare > 0) || !(price > 0)) return 0;
  const byRisk = (risk.capital * risk.riskPerTrade) / riskPerShare;
  const byValue = (risk.capital * risk.maxPositionFraction) / price;
  return Math.max(0, Math.floor(Math.min(byRisk, byValue)));
}
