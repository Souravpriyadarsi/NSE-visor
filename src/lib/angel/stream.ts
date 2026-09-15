/** Angel One SmartAPI WebSocket 2.0: live prices and best-5 market depth. */
export const STREAM_URL = 'wss://smartapisocket.angelone.in/smart-stream';

export const MODE = { ltp: 1, quote: 2, snapQuote: 3 } as const;
/** NSE cash market. */
export const NSE_CM = 1;

export type DepthLevel = { price: number; quantity: number; orders: number };

export type DepthTick = {
  token: string;
  mode: number;
  /** Exchange time, in milliseconds. */
  time: number;
  ltp: number;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Previous day's close. */
  close: number | null;
  /** Everything waiting to buy and sell across the whole order book. */
  totalBuyQty: number | null;
  totalSellQty: number | null;
  /** Best 5 buyers (highest price first) and sellers (lowest price first). */
  bids: DepthLevel[];
  asks: DepthLevel[];
};

/** Equity prices arrive in paise. */
const PAISE = 100;
const LTP_BYTES = 51;
const QUOTE_BYTES = 123;
const SNAP_QUOTE_BYTES = 379;
const DEPTH_START = 147;
const DEPTH_PACKET = 20;

/** Reads one binary tick (little-endian). Null for anything too short to be a tick. */
export function parseTick(data: ArrayBuffer): DepthTick | null {
  if (data.byteLength < LTP_BYTES) return null;
  const view = new DataView(data);
  const int64 = (offset: number) => Number(view.getBigInt64(offset, true));
  const tokenBytes = new Uint8Array(data, 2, 25);
  const end = tokenBytes.indexOf(0);
  const mode = view.getUint8(0);

  const tick: DepthTick = {
    token: new TextDecoder().decode(end < 0 ? tokenBytes : tokenBytes.subarray(0, end)),
    mode,
    time: int64(35),
    ltp: int64(43) / PAISE,
    volume: null,
    open: null,
    high: null,
    low: null,
    close: null,
    totalBuyQty: null,
    totalSellQty: null,
    bids: [],
    asks: [],
  };

  if (mode >= MODE.quote && data.byteLength >= QUOTE_BYTES) {
    tick.volume = int64(67);
    tick.totalBuyQty = view.getFloat64(75, true);
    tick.totalSellQty = view.getFloat64(83, true);
    tick.open = int64(91) / PAISE;
    tick.high = int64(99) / PAISE;
    tick.low = int64(107) / PAISE;
    tick.close = int64(115) / PAISE;
  }

  if (mode === MODE.snapQuote && data.byteLength >= SNAP_QUOTE_BYTES) {
    for (let k = 0; k < 10; k++) {
      const base = DEPTH_START + k * DEPTH_PACKET;
      const level = { price: int64(base + 10) / PAISE, quantity: int64(base + 2), orders: view.getUint16(base + 18, true) };
      if (level.quantity <= 0 && level.price <= 0) continue;
      (view.getUint16(base, true) === 0 ? tick.bids : tick.asks).push(level);
    }
    tick.bids.sort((a, b) => b.price - a.price);
    tick.asks.sort((a, b) => a.price - b.price);
    // Guard against a flipped buy/sell flag: buyers can't be priced above sellers.
    if (tick.bids.length && tick.asks.length && tick.bids[0].price > tick.asks[0].price) {
      [tick.bids, tick.asks] = [tick.asks.reverse(), tick.bids.reverse()];
    }
  }
  return tick;
}

/** Subscribe (action 1) or unsubscribe (action 0) NSE cash tokens. */
export function subscribeMessage(tokens: string[], mode: number = MODE.snapQuote, action: 0 | 1 = 1): string {
  return JSON.stringify({ correlationID: 'nsevisor01', action, params: { mode, tokenList: [{ exchangeType: NSE_CM, tokens }] } });
}
