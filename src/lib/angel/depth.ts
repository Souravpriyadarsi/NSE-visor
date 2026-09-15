import type { DepthTick } from './stream.ts';

export type DepthSummary = {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spread: number | null;
  /** Spread as a share of the mid price. */
  spreadPct: number | null;
  /** Shares wanted by the best 5 buyers and offered by the best 5 sellers. */
  bidQty: number;
  askQty: number;
  /** From -1 (all sellers) to +1 (all buyers), across the best 5 levels each side. */
  imbalance: number | null;
  /** Whole-book buy quantity divided by sell quantity. */
  buySellRatio: number | null;
};

export function summarizeDepth(tick: Pick<DepthTick, 'bids' | 'asks' | 'totalBuyQty' | 'totalSellQty'>): DepthSummary {
  const bestBid = tick.bids[0]?.price ?? null;
  const bestAsk = tick.asks[0]?.price ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const bidQty = tick.bids.reduce((sum, level) => sum + level.quantity, 0);
  const askQty = tick.asks.reduce((sum, level) => sum + level.quantity, 0);
  return {
    bestBid,
    bestAsk,
    mid,
    spread,
    spreadPct: spread != null && mid ? spread / mid : null,
    bidQty,
    askQty,
    imbalance: bidQty + askQty > 0 ? (bidQty - askQty) / (bidQty + askQty) : null,
    buySellRatio: tick.totalBuyQty != null && tick.totalSellQty ? tick.totalBuyQty / tick.totalSellQty : null,
  };
}
