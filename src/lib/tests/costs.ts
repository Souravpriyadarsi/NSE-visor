/** Typical discount-broker charges for NSE equity (Zerodha's published rates, September 2026). */
export const CHARGES = {
  intradayBrokerageRate: 0.0003,
  intradayBrokerageCap: 20,
  sttIntradaySell: 0.00025,
  sttDelivery: 0.001,
  exchangeRate: 0.0000307,
  sebiRate: 0.000001,
  stampIntradayBuy: 0.00003,
  stampDeliveryBuy: 0.00015,
  gstRate: 0.18,
  /** Depository charge per stock per day on delivery sells, GST included. Also applies to BTST sells. */
  dpChargePerSell: 15.34,
} as const;

/** intraday: bought and sold the same day. delivery: held overnight (including buy today, sell tomorrow). */
export type TradeKind = 'intraday' | 'delivery';

/** All charges on one executed order worth `value` rupees. */
export function orderCharges(value: number, side: 'buy' | 'sell', kind: TradeKind): number {
  if (value <= 0) return 0;
  const c = CHARGES;
  const brokerage = kind === 'intraday' ? Math.min(value * c.intradayBrokerageRate, c.intradayBrokerageCap) : 0;
  const stt = kind === 'delivery' ? value * c.sttDelivery : side === 'sell' ? value * c.sttIntradaySell : 0;
  const exchange = value * c.exchangeRate;
  const sebi = value * c.sebiRate;
  const stamp = side === 'buy' ? value * (kind === 'intraday' ? c.stampIntradayBuy : c.stampDeliveryBuy) : 0;
  const gst = (brokerage + exchange + sebi) * c.gstRate;
  const dp = kind === 'delivery' && side === 'sell' ? c.dpChargePerSell : 0;
  return brokerage + stt + exchange + sebi + stamp + gst + dp;
}

/** The most whole shares whose cost plus charges fit in the cash. */
export function affordableShares(cash: number, price: number, charges: (value: number) => number): number {
  if (!(price > 0) || !(cash > 0)) return 0;
  const fits = (shares: number) => shares * price + charges(shares * price) <= cash;
  let shares = Math.floor(cash / price);
  while (shares > 0 && !fits(shares)) {
    const over = shares * price + charges(shares * price) - cash;
    shares -= Math.max(1, Math.floor(over / price));
  }
  shares = Math.max(0, shares);
  while (fits(shares + 1)) shares++;
  return shares;
}
