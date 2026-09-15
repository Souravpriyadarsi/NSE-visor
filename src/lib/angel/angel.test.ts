import { describe, expect, it } from 'vitest';
import { candleRanges, candlesToHistory, type CandleRow } from './candles.ts';
import { readAngelConfig } from './config.ts';
import { summarizeDepth } from './depth.ts';
import { toAngelTokens, type ScripRow } from './instruments.ts';
import { MODE, parseTick, subscribeMessage } from './stream.ts';
import { base32Decode, totp } from './totp.ts';

describe('totp', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32 of "12345678901234567890", RFC 6238's test key

  it('matches the RFC 6238 test vectors', async () => {
    expect(await totp(secret, 59_000)).toBe('287082');
    expect(await totp(secret, 1_111_111_109_000)).toBe('081804');
    expect(await totp(secret, 1_234_567_890_000)).toBe('005924');
  });

  it('accepts secrets with spaces and lower case', async () => {
    expect(await totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000)).toBe('287082');
    expect(new TextDecoder().decode(base32Decode('MZXW6==='))).toBe('foo');
  });
});

/** A SNAP_QUOTE packet laid out byte by byte like Angel One's. */
function snapQuote(): ArrayBuffer {
  const buffer = new ArrayBuffer(379);
  const view = new DataView(buffer);
  view.setUint8(0, MODE.snapQuote);
  view.setUint8(1, 1);
  new TextEncoder().encodeInto('2885', new Uint8Array(buffer, 2, 25));
  const int64 = (offset: number, value: number) => view.setBigInt64(offset, BigInt(value), true);
  int64(27, 42);
  int64(35, 1_789_453_500_000);
  int64(43, 126050);
  int64(51, 10);
  int64(59, 125900);
  int64(67, 8_000_000);
  view.setFloat64(75, 250_000, true);
  view.setFloat64(83, 310_000, true);
  int64(91, 125000);
  int64(99, 127000);
  int64(107, 124500);
  int64(115, 125750);
  for (let k = 0; k < 10; k++) {
    const base = 147 + k * 20;
    const buy = k < 5;
    view.setUint16(base, buy ? 0 : 1, true);
    int64(base + 2, 100 * (k + 1));
    int64(base + 10, buy ? 126000 - k * 5 : 126100 + (k - 5) * 5);
    view.setUint16(base + 18, k + 1, true);
  }
  return buffer;
}

describe('parseTick', () => {
  it('reads prices in rupees and the best 5 on each side', () => {
    const tick = parseTick(snapQuote())!;
    expect(tick.token).toBe('2885');
    expect(tick.time).toBe(1_789_453_500_000);
    expect(tick.ltp).toBe(1260.5);
    expect(tick.volume).toBe(8_000_000);
    expect([tick.open, tick.high, tick.low, tick.close]).toEqual([1250, 1270, 1245, 1257.5]);
    expect([tick.totalBuyQty, tick.totalSellQty]).toEqual([250_000, 310_000]);
    expect(tick.bids).toHaveLength(5);
    expect(tick.bids[0]).toEqual({ price: 1260, quantity: 100, orders: 1 });
    expect(tick.asks[0]).toEqual({ price: 1261, quantity: 600, orders: 6 });
    expect(tick.asks[4].price).toBe(1261.2);
  });

  it('handles price-only packets and rejects short ones', () => {
    const buffer = snapQuote().slice(0, 51);
    new DataView(buffer).setUint8(0, MODE.ltp);
    const tick = parseTick(buffer)!;
    expect(tick.ltp).toBe(1260.5);
    expect(tick.bids).toEqual([]);
    expect(tick.volume).toBeNull();
    expect(parseTick(new ArrayBuffer(10))).toBeNull();
  });

  it('builds subscribe messages for NSE cash', () => {
    expect(JSON.parse(subscribeMessage(['2885', '1594']))).toEqual({
      correlationID: 'nsevisor01',
      action: 1,
      params: { mode: 3, tokenList: [{ exchangeType: 1, tokens: ['2885', '1594'] }] },
    });
  });
});

describe('summarizeDepth', () => {
  it('measures the spread and who is waiting on each side', () => {
    const summary = summarizeDepth({
      bids: [
        { price: 1260, quantity: 100, orders: 1 },
        { price: 1259.95, quantity: 200, orders: 2 },
      ],
      asks: [{ price: 1260.1, quantity: 100, orders: 1 }],
      totalBuyQty: 300,
      totalSellQty: 150,
    });
    expect(summary.spread).toBeCloseTo(0.1);
    expect(summary.spreadPct).toBeCloseTo(0.1 / 1260.05);
    expect(summary.imbalance).toBeCloseTo(0.5);
    expect(summary.buySellRatio).toBe(2);
  });
});

describe('toAngelTokens', () => {
  it('maps NSE stocks and indices to tokens, preferring the normal series', () => {
    const row = (token: string, symbol: string, exch_seg = 'NSE', instrumenttype = ''): ScripRow => ({ token, symbol, name: '', exch_seg, instrumenttype });
    const tokens = toAngelTokens([
      row('2885', 'RELIANCE-EQ'),
      row('2031', 'M&M-EQ'),
      row('1', 'FOO-BE'),
      row('2', 'FOO-EQ'),
      row('3', 'BAR-BZ'),
      row('9', 'RELIANCE25SEPFUT', 'NFO'),
      row('99926000', 'Nifty 50', 'NSE', 'AMXIDX'),
      row('5', 'BAD_NAME-EQ'),
    ]);
    expect(tokens).toEqual({ 'RELIANCE.NS': '2885', 'M&M.NS': '2031', 'FOO.NS': '2', 'BAR.NS': '3', '^NSEI': '99926000' });
  });
});

describe('candles', () => {
  const at = (iso: string, close: number): CandleRow => [iso, close, close, close, close, 100];

  it('keeps completed market-hours bars, grouped by trading day', () => {
    const history = candlesToHistory(
      'RELIANCE.NS',
      '5m',
      [
        at('2026-09-14T09:10:00+05:30', 1),
        at('2026-09-14T09:15:00+05:30', 2),
        at('2026-09-14T15:30:00+05:30', 3),
        at('2026-09-15T09:15:00+05:30', 4),
        at('2026-09-15T09:15:00+05:30', 4),
        at('2026-09-15T09:20:00+05:30', 5),
      ],
      new Date('2026-09-15T09:22:00+05:30'),
    );
    expect(history.sessions.map((s) => [s.date, s.bars.map((b) => b[4])])).toEqual([
      ['2026-09-14', [2]],
      ['2026-09-15', [4]],
    ]);
  });

  it('splits long requests within the per-request limit', () => {
    const ranges = candleRanges('1m', 60, new Date('2026-09-15T10:00:00+05:30'));
    expect(ranges).toHaveLength(3);
    expect(ranges[0][0]).toBe('2026-07-17 10:00');
    expect(ranges[ranges.length - 1][1]).toBe('2026-09-15 10:00');
  });
});

describe('readAngelConfig', () => {
  it('needs all four login details', () => {
    expect(readAngelConfig({})).toBeNull();
    expect(readAngelConfig({ ANGEL_API_KEY: 'k', ANGEL_CLIENT_CODE: 'c', ANGEL_PIN: '1234' })).toBeNull();
  });

  it('reads the stocks to record', () => {
    const config = readAngelConfig({
      ANGEL_API_KEY: 'k',
      ANGEL_CLIENT_CODE: 'c',
      ANGEL_PIN: '1234',
      ANGEL_TOTP_SECRET: 'GEZDGNBV',
      ANGEL_RECORD: ' reliance, infy ,INFY,',
    })!;
    expect(config.record).toEqual(['RELIANCE.NS', 'INFY.NS']);
    expect(config.credentials.historicalApiKey).toBeUndefined();
  });
});
