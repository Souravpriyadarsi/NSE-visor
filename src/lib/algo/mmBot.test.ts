import { describe, expect, it } from 'vitest';
import type { IntradayBar, IntradayHistory, IntradaySession } from '../intraday/bars.ts';
import { advanceBot, DEFAULT_BOT_STATE, liveView, parseBotState, stopBot, type BotState } from './mmBot.ts';

type Ohlc = [open: number, high: number, low: number, close: number];

/** A day's 5-minute bars from 09:15 IST, with the last one at 15:25 when the day is `finished`. */
function session(date: string, bars: Ohlc[], finished = true): IntradaySession {
  const open = Date.parse(`${date}T09:15:00+05:30`) / 1000;
  const close = Date.parse(`${date}T15:25:00+05:30`) / 1000;
  return {
    date,
    bars: bars.map(([o, h, l, c], i): IntradayBar => [finished && i === bars.length - 1 ? close : open + i * 300, o, h, l, c, 1000]),
  };
}

/** Mid-morning on the third day, while its session is still trading. */
const NOW = Date.parse('2026-09-16T10:00:00+05:30') / 1000;
const flat = (price: number): Ohlc => [price, price, price, price];
const history = (sessions: IntradaySession[]): IntradayHistory => ({ symbol: 'T.NS', interval: '5m', sessions });

const started: BotState = {
  ...DEFAULT_BOT_STATE,
  settings: { ...DEFAULT_BOT_STATE.settings, symbols: ['T.NS'], shares: 10, trail: '2' },
  startedAt: Date.parse('2026-09-14T08:00:00+05:30') / 1000,
};

const day1 = session('2026-09-14', [flat(100), flat(100)]);
// Rises ₹3 in one bar: the whole holding's stop arms at ₹102, and the worst case sells it at ₹101 straight after.
const day2 = session('2026-09-15', [[100, 103, 100, 102.5], flat(102)]);

describe('advanceBot', () => {
  it('buys at every close and sells on the trailing stop, assuming the worst order inside a bar', () => {
    const state = advanceBot(started, [history([day1, day2])], NOW);
    expect(state.orders.map((o) => [o.date, o.side, o.price, o.reason])).toEqual([
      ['2026-09-14', 'buy', 100, 'buy'],
      ['2026-09-15', 'sell', 101, 'whole'],
      ['2026-09-15', 'buy', 102, 'buy'],
    ]);
    expect(state.lots['T.NS']).toHaveLength(1);
    expect(state.days.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15']);
    expect(state.orders[1].pnl).toBeCloseTo(10 * 1 - state.orders[0].charges - state.orders[1].charges, 6);
  });

  it('trades each day once, however often the prices are reloaded', () => {
    const once = advanceBot(started, [history([day1, day2])], NOW);
    expect(advanceBot(once, [history([day1, day2])], NOW)).toBe(once);
    const stepwise = advanceBot(advanceBot(started, [history([day1])], NOW), [history([day1, day2])], NOW);
    expect(stepwise.orders).toEqual(once.orders);
    expect(stepwise.cash).toBeCloseTo(once.cash, 6);
  });

  it('skips days before the bot was started, and skips buys it cannot afford', () => {
    const late = { ...started, startedAt: Date.parse('2026-09-14T16:00:00+05:30') / 1000 };
    expect(advanceBot(late, [history([day1, day2])], NOW).orders.map((o) => o.date)).toEqual(['2026-09-15']);
    const poor = { ...started, cash: 500 };
    const state = advanceBot(poor, [history([day1])], NOW);
    expect(state.orders).toHaveLength(0);
    expect(state.days[0].skipped).toBe(1);
  });
});

describe('liveView and stopBot', () => {
  const today = session('2026-09-16', [flat(102), [102, 102.5, 101.5, 102.2]], false);

  it("shows today's bars so far without booking them", () => {
    const state = advanceBot(started, [history([day1, day2, today])], NOW);
    expect(state.orders).toHaveLength(3);
    const live = liveView(state, history([day1, day2, today]), NOW)!;
    expect(live.session.date).toBe('2026-09-16');
    expect(live.held).toHaveLength(1);
    expect(live.lastPrice).toBe(102.2);
  });

  it('sells everything when stopped, and the cash then matches the profits booked', () => {
    const histories = [history([day1, day2, today])];
    const stopped = stopBot(advanceBot(started, histories, NOW), histories, NOW);
    expect(stopped.startedAt).toBeNull();
    expect(stopped.lots).toEqual({});
    const last = stopped.orders[stopped.orders.length - 1];
    expect([last.side, last.price, last.reason]).toEqual(['sell', 102.2, 'stop']);
    const profit = stopped.orders.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
    expect(stopped.cash - started.cash).toBeCloseTo(profit, 6);
    // Restarting doesn't replay what was already traded.
    const restarted = advanceBot({ ...stopped, startedAt: Date.parse('2026-09-16T10:05:00+05:30') / 1000 }, histories, NOW);
    expect(restarted.orders).toEqual(stopped.orders);
  });

  it('counts today as finished shortly after 15:30 even when the last bars never arrive', () => {
    const shortDay = session('2026-09-16', [flat(102), flat(103)], false);
    const evening = Date.parse('2026-09-16T15:40:00+05:30') / 1000;
    const state = advanceBot(started, [history([day1, day2, shortDay])], evening);
    expect(state.orders.at(-1)).toMatchObject({ date: '2026-09-16', side: 'buy', price: 103 });
    expect(liveView(state, history([day1, day2, shortDay]), evening)).toBeNull();
  });

  it('rejects saved state it does not recognise', () => {
    expect(parseBotState({ nope: true })).toBeNull();
    expect(parseBotState(JSON.parse(JSON.stringify(started)))).toEqual(started);
  });
});
