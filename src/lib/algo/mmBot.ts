// The Algo trading tab's paper bot: Minimal Margin Maximus run live on 5-minute prices with a pretend cash account.
// Everything here is pure, so the bot can replay from saved state and fresh prices after a page refresh.
import {
  completedSessions,
  INTERVAL_SECONDS,
  istDate,
  istMinute,
  MARKET_CLOSE_MINUTE,
  type IntradayHistory,
  type IntradaySession,
} from '../intraday/bars.ts';
import { CHARGES, orderCharges } from '../tests/costs.ts';
import {
  DEFAULT_TRAIL,
  insertLot,
  TRAIL_RULES,
  trailRule,
  tradeSession,
  type MmBar,
  type SessionSell,
  type TrailKey,
} from '../tests/marginMaximus.ts';

export const MAX_BOT_STOCKS = 5;
export const BOT_SHARE_CHOICES = [10, 50, 100, 200] as const;
export const DEFAULT_BOT_CASH = 1_000_000;
/** Live prices only say how high and low each 5-minute bar went, so the bot always assumes the less favourable order. */
const WORST_CASE = true;

export type BotSettings = {
  symbols: string[];
  /** Shares bought per stock at every close. */
  shares: number;
  trail: TrailKey;
  /** Pretend money the account starts with. Buys are skipped when there isn't enough left. */
  startingCash: number;
};

/** One day's buy of one stock, still held. */
export type BotLot = { buyPrice: number; date: string; shares: number; buyCharges: number };

export type BotOrderReason = 'buy' | 'whole' | 'lot' | 'close' | 'stop';

export type BotOrder = {
  /** Unix seconds: the end of the 5-minute bar it filled in, or when the bot was stopped. */
  time: number;
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  charges: number;
  reason: BotOrderReason;
  /** Sells: profit after the charges on both the buy and the sell. */
  pnl: number | null;
};

export const ORDER_REASONS: Record<BotOrderReason, string> = {
  buy: 'Daily buy at the close',
  whole: 'Trailing stop on the whole holding',
  lot: 'Trailing stop on this lot',
  close: 'Stop armed, sold at the close',
  stop: 'Bot stopped: sold everything',
};

export type BotDay = {
  date: string;
  buys: number;
  sells: number;
  /** Buys skipped because there wasn't enough cash. */
  skipped: number;
  charges: number;
  /** Profit from the day's sells, after charges on both sides. */
  realized: number;
  cash: number;
  /** Cash plus what the held shares were worth at the day's close. */
  value: number;
  heldShares: number;
};

export type BotState = {
  settings: BotSettings;
  /** When the bot was last started (unix seconds), or null while it's off. */
  startedAt: number | null;
  /** Prices up to here (unix seconds) have been traded; later bars are still to come. */
  processedUntil: number | null;
  cash: number;
  lots: Record<string, BotLot[]>;
  /** The latest traded price per stock, to value the holding. */
  lastPrice: Record<string, number>;
  orders: BotOrder[];
  days: BotDay[];
};

export const DEFAULT_BOT_STATE: BotState = {
  settings: { symbols: [], shares: 10, trail: DEFAULT_TRAIL, startingCash: DEFAULT_BOT_CASH },
  startedAt: null,
  processedUntil: null,
  cash: DEFAULT_BOT_CASH,
  lots: {},
  lastPrice: {},
  orders: [],
  days: [],
};

/** Oldest orders are dropped past this, so browser storage doesn't fill up. */
const MAX_ORDERS = 3000;

export function parseBotState(stored: unknown): BotState | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const s = stored as Partial<BotState>;
  const settings = s.settings;
  if (
    !settings ||
    !Array.isArray(settings.symbols) ||
    typeof settings.shares !== 'number' ||
    typeof settings.startingCash !== 'number' ||
    !TRAIL_RULES.some((rule) => rule.key === settings.trail) ||
    typeof s.cash !== 'number'
  ) {
    return null;
  }
  return {
    settings,
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : null,
    processedUntil: typeof s.processedUntil === 'number' ? s.processedUntil : null,
    cash: s.cash,
    lots: typeof s.lots === 'object' && s.lots ? s.lots : {},
    lastPrice: typeof s.lastPrice === 'object' && s.lastPrice ? s.lastPrice : {},
    orders: Array.isArray(s.orders) ? s.orders : [],
    days: Array.isArray(s.days) ? s.days : [],
  };
}

const toBars = (session: IntradaySession): MmBar[] => session.bars.map(([, open, high, low, close]) => ({ open, high, low, close }));
const barEnd = (history: IntradayHistory, session: IntradaySession, bar: number) => session.bars[bar][0] + INTERVAL_SECONDS[history.interval];
const sessionEnd = (history: IntradayHistory, session: IntradaySession) => barEnd(history, session, session.bars.length - 1);

/** Yahoo's last bar of the day often ends at 15:20 or never arrives, so a day also counts as finished at 15:35. */
const DAY_DONE_MINUTE = MARKET_CLOSE_MINUTE + 5;

/** Sessions that are over by `now`: earlier days, and today once the market has closed. */
function finishedSessions(history: IntradayHistory, now: number): IntradaySession[] {
  const today = istDate(now);
  const complete = new Set(completedSessions(history));
  return history.sessions.filter(
    (s) => s.bars.length > 0 && (complete.has(s) || s.date < today || (s.date === today && istMinute(now) >= DAY_DONE_MINUTE)),
  );
}

/** What the held shares are worth at the latest prices. */
export function holdingValue(state: Pick<BotState, 'lots' | 'lastPrice'>): number {
  let value = 0;
  for (const [symbol, lots] of Object.entries(state.lots)) {
    for (const lot of lots) value += lot.shares * (state.lastPrice[symbol] ?? lot.buyPrice);
  }
  return value;
}

export const heldShares = (lots: Record<string, BotLot[]>) =>
  Object.values(lots).reduce((sum, list) => sum + list.reduce((s, lot) => s + lot.shares, 0), 0);

/** Mutable working copy used while trading a batch of prices. */
type Book = Omit<BotState, 'settings' | 'startedAt' | 'processedUntil'>;

function copyBook(state: BotState): Book {
  return {
    cash: state.cash,
    lots: Object.fromEntries(Object.entries(state.lots).map(([symbol, lots]) => [symbol, [...lots]])),
    lastPrice: { ...state.lastPrice },
    orders: [...state.orders],
    days: state.days.map((day) => ({ ...day })),
  };
}

function dayOf(book: Book, date: string): BotDay {
  let day = book.days.find((d) => d.date === date);
  if (!day) {
    day = { date, buys: 0, sells: 0, skipped: 0, charges: 0, realized: 0, cash: book.cash, value: book.cash, heldShares: 0 };
    book.days.push(day);
    book.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return day;
}

function closeDay(book: Book, day: BotDay) {
  day.cash = book.cash;
  day.value = book.cash + holdingValue(book);
  day.heldShares = heldShares(book.lots);
}

/** Books sells, sharing one depository charge per stock per day like a broker does. */
function bookSells(book: Book, symbol: string, date: string, sells: { lot: BotLot; price: number; time: number; reason: BotOrderReason }[]) {
  if (sells.length === 0) return;
  const day = dayOf(book, date);
  const dpAlreadyPaid = book.orders.some((o) => o.symbol === symbol && o.date === date && o.side === 'sell');
  sells.forEach((sell, i) => {
    const value = sell.lot.shares * sell.price;
    const charges = orderCharges(value, 'sell', 'delivery') - (dpAlreadyPaid || i > 0 ? CHARGES.dpChargePerSell : 0);
    const pnl = value - sell.lot.shares * sell.lot.buyPrice - charges - sell.lot.buyCharges;
    book.cash += value - charges;
    book.orders.push({ time: sell.time, date, symbol, side: 'sell', shares: sell.lot.shares, price: sell.price, charges, reason: sell.reason, pnl });
    day.sells++;
    day.charges += charges;
    day.realized += pnl;
  });
}

function buyAtClose(book: Book, settings: BotSettings, symbol: string, date: string, price: number, time: number) {
  const day = dayOf(book, date);
  const cost = settings.shares * price;
  const charges = orderCharges(cost, 'buy', 'delivery');
  if (book.cash < cost + charges) {
    day.skipped++;
    return;
  }
  book.cash -= cost + charges;
  const lots = (book.lots[symbol] ??= []);
  insertLot(lots, { buyPrice: price, date, shares: settings.shares, buyCharges: charges });
  book.orders.push({ time, date, symbol, side: 'buy', shares: settings.shares, price, charges, reason: 'buy', pnl: null });
  day.buys++;
  day.charges += charges;
}

const sellsOf = (history: IntradayHistory, session: IntradaySession, sells: SessionSell<BotLot>[]) =>
  sells.map((s) => ({ lot: s.lot, price: s.price, time: barEnd(history, session, s.bar), reason: s.reason as BotOrderReason }));

function trimOrders(book: Book) {
  if (book.orders.length > MAX_ORDERS) book.orders = book.orders.slice(-MAX_ORDERS);
}

/**
 * Trades every finished session the bot hasn't seen yet, day by day across its stocks: trailing stops during the
 * day, anything armed sold at the close, then the day's buy. Returns the same state object when there's nothing new.
 */
export function advanceBot(state: BotState, histories: IntradayHistory[], now: number): BotState {
  if (state.startedAt == null) return state;
  const since = Math.max(state.startedAt, state.processedUntil ?? 0);
  const rules = trailRule(state.settings.trail);

  const byDate = new Map<string, { history: IntradayHistory; session: IntradaySession }[]>();
  for (const history of histories) {
    for (const session of finishedSessions(history, now)) {
      if (sessionEnd(history, session) <= since) continue;
      const list = byDate.get(session.date) ?? [];
      list.push({ history, session });
      byDate.set(session.date, list);
    }
  }
  if (byDate.size === 0) return state;

  const book = copyBook(state);
  let processedUntil = state.processedUntil ?? since;
  for (const date of [...byDate.keys()].sort()) {
    for (const { history, session } of byDate.get(date)!) {
      const symbol = history.symbol;
      // Bars before the bot was started (or before a stop the same day) have already been dealt with.
      const first = session.bars.findIndex((bar) => bar[0] >= since);
      const bars = toBars(session).slice(first < 0 ? session.bars.length : first);
      const traded = tradeSession(book.lots[symbol] ?? [], bars, rules, WORST_CASE);
      const offset = session.bars.length - bars.length;
      book.lots[symbol] = traded.held;
      bookSells(book, symbol, date, sellsOf(history, session, traded.sells.map((s) => ({ ...s, bar: s.bar + offset }))));
      const last = session.bars[session.bars.length - 1];
      book.lastPrice[symbol] = last[4];
      buyAtClose(book, state.settings, symbol, date, last[4], sessionEnd(history, session));
      processedUntil = Math.max(processedUntil, sessionEnd(history, session));
    }
    closeDay(book, dayOf(book, date));
  }
  trimOrders(book);
  return { ...state, ...book, processedUntil };
}

/** Today's session so far for one stock, when it's still trading and newer than what the bot has already traded. */
export function liveSession(state: BotState, history: IntradayHistory, now: number): IntradaySession | null {
  const last = history.sessions[history.sessions.length - 1];
  if (!last || last.bars.length === 0 || finishedSessions(history, now).includes(last)) return null;
  const since = Math.max(state.startedAt ?? Infinity, state.processedUntil ?? 0);
  return sessionEnd(history, last) > since ? last : null;
}

export type LiveView = {
  session: IntradaySession;
  /** Sells so far today, as orders. They're booked for good at the close. */
  sells: BotOrder[];
  sold: { lot: BotLot; price: number; time: number; reason: BotOrderReason }[];
  held: BotLot[];
  armed: { lot: BotLot; stop: number }[];
  /** The stop covering the whole holding, once it has armed. */
  wholeStop: number | null;
  lastPrice: number;
};

/** Replays today's bars so far over the stock's held lots, without booking anything. */
export function liveView(state: BotState, history: IntradayHistory, now: number): LiveView | null {
  const session = liveSession(state, history, now);
  if (!session) return null;
  const since = Math.max(state.startedAt ?? 0, state.processedUntil ?? 0);
  const first = session.bars.findIndex((bar) => bar[0] >= since);
  const offset = first < 0 ? session.bars.length : first;
  const rules = trailRule(state.settings.trail);
  const traded = tradeSession(state.lots[history.symbol] ?? [], toBars(session).slice(offset), rules, WORST_CASE, { closeDay: false });
  const sold = sellsOf(history, session, traded.sells.map((s) => ({ ...s, bar: s.bar + offset })));
  const book = copyBook(state);
  book.orders = [];
  bookSells(book, history.symbol, session.date, sold);
  return {
    session,
    sells: book.orders,
    sold,
    held: traded.held,
    armed: traded.armed.map(({ lot, trail }) => ({ lot, stop: trail - rules.trail })),
    wholeStop: traded.wholeTrail == null ? null : traded.wholeTrail - rules.trail,
    lastPrice: session.bars[session.bars.length - 1][4],
  };
}

/** Turns the bot off and sells every held share: today's stops so far first, then the rest at the latest price. */
export function stopBot(state: BotState, histories: IntradayHistory[], now: number): BotState {
  const advanced = advanceBot(state, histories, now);
  const book = copyBook(advanced);
  for (const history of histories) {
    const symbol = history.symbol;
    const live = liveView(advanced, history, now);
    let lots = book.lots[symbol] ?? [];
    let date = istDate(now);
    if (live) {
      date = live.session.date;
      bookSells(book, symbol, date, live.sold);
      lots = live.held;
      book.lastPrice[symbol] = live.lastPrice;
    }
    const price = book.lastPrice[symbol];
    if (lots.length > 0 && price != null) {
      bookSells(book, symbol, date, lots.map((lot) => ({ lot, price, time: now, reason: 'stop' as const })));
      closeDay(book, dayOf(book, date));
    }
    book.lots[symbol] = [];
  }
  trimOrders(book);
  return { ...advanced, ...book, lots: {}, startedAt: null, processedUntil: now };
}

