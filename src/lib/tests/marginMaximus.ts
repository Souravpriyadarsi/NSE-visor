import type { IntradayHistory } from '../intraday/bars.ts';
import { completedSessions } from '../intraday/bars.ts';
import type { HistoryFile } from '../../types.ts';
import { SUSPICIOUS_LOG_MOVE } from '../data/yahoo.ts';
import { CHARGES, orderCharges } from './costs.ts';
import type { PeriodKey } from './sameDay.ts';

/** One price bar: a whole trading day in the daily test, or one 5-minute bar in the intraday check. */
export type MmBar = { open: number; high: number; low: number; close: number };

/** One trading day: a single bar for the daily test, or that day's 5-minute bars. */
export type MmSession = { date: string; bars: MmBar[] };

/** How far the price must rise before a trailing stop arms, and how far it may then fall back. */
export type StopRules = { trigger: number; trail: number };

export type TrailKey = '1' | '2' | '5' | '10';
export type TrailRule = StopRules & { key: TrailKey; label: string };

export const TRAIL_RULES: TrailRule[] = [
  { key: '1', trigger: 1, trail: 0.5, label: '₹1 up, ₹0.50 trail' },
  { key: '2', trigger: 2, trail: 1, label: '₹2 up, ₹1 trail' },
  { key: '5', trigger: 5, trail: 2, label: '₹5 up, ₹2 trail' },
  { key: '10', trigger: 10, trail: 5, label: '₹10 up, ₹5 trail' },
];
export const DEFAULT_TRAIL: TrailKey = '2';
export const trailRule = (key: TrailKey) => TRAIL_RULES.find((rule) => rule.key === key) ?? TRAIL_RULES[1];

/** The highest price since a stop armed, or null while the position is still waiting for its trigger. */
export type Trail = number | null;

/** The price a stop arms at, or null when the bar never reaches reference + trigger. A gap-up arms at the open. */
export function armingPrice(bar: MmBar, reference: number, trigger: number): number | null {
  return bar.high >= reference + trigger ? Math.max(bar.open, reference + trigger) : null;
}

/**
 * Runs one bar for one position (a single lot, or the whole holding), in per-share terms.
 *
 * `reference` is the buy price the trigger is measured from; `trail` is the highest price since the stop armed,
 * or null while the position is still waiting. The bar only says how high and how low the price went, not in which
 * order, so `worst` picks the least favourable order inside the bar and false picks the most favourable one.
 * Running the whole test both ways turns every result into a range.
 */
export function stepBar(bar: MmBar, reference: number, trail: Trail, rules: StopRules, worst: boolean): { trail: Trail; exit: number | null } {
  let peak = trail;
  if (peak == null) {
    const armed = armingPrice(bar, reference, rules.trigger);
    if (armed == null) return { trail: null, exit: null };
    peak = armed;
  } else if (bar.open <= peak - rules.trail) {
    // Armed in an earlier bar and the price opens below the stop: it sells there, whichever order the bar ran in.
    return { trail: peak, exit: bar.open };
  }
  const high = Math.max(peak, bar.high);

  if (worst) {
    // Worst case: the fall comes straight after arming, while the stop is still at its lowest level.
    const stop = peak - rules.trail;
    const sold = bar.low <= stop || bar.high - bar.low >= rules.trail || bar.close < high - rules.trail;
    return { trail: high, exit: sold ? Math.max(stop, bar.low) : null };
  }
  // Best case: the high comes first, so the stop only sells when the close is more than the trail below it.
  return { trail: high, exit: bar.close < high - rules.trail ? high - rules.trail : null };
}

/** One lot sold: what one share cost, what it fetched, and how many days it was held. */
export type MmSell = { buyPrice: number; sellPrice: number; heldDays: number };

/** What the strategy did on one trading day, per share: it never depends on how many shares a lot holds. */
export type MmDay = {
  date: string;
  close: number;
  sells: MmSell[];
  /** Price the day's new lot was bought at (the day's close). */
  buyPrice: number;
  /** Lots still held after the day's selling and buying, and what one share of each cost in total. */
  heldLots: number;
  heldCost: number;
};

type OpenLot = { buyPrice: number; day: number; trail: Trail };

/** Keeps the waiting lots cheapest first, so the ones reaching their trigger are always at the front. */
function insertLot(lots: OpenLot[], lot: OpenLot) {
  let low = 0;
  let high = lots.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lots[middle].buyPrice < lot.buyPrice) low = middle + 1;
    else high = middle;
  }
  lots.splice(low, 0, lot);
}

/**
 * Minimal Margin Maximus: buy one lot at every close and let trailing stops take the profits.
 *
 * Every bar, in this order:
 *  1. the whole holding first — once the price reaches the average buy price of every share held + trigger,
 *     one trailing stop covers all of them and sells the lot whenever the price falls `trail` below its high;
 *  2. otherwise each lot on its own, so cheaper lots can sell while the rest wait;
 *  3. anything armed but not stopped is sold at the day's close;
 *  4. lots that never reach their trigger are simply held — there is no stop-loss — and the day's new lot is
 *     bought at the close after that day's selling, so positions pile up while the price falls.
 */
export function planTrades(sessions: MmSession[], rules: StopRules, worst: boolean): MmDay[] {
  const waiting: OpenLot[] = []; // not armed yet, cheapest buy price first
  let armed: OpenLot[] = []; // stops already armed, which only outlive a bar in the 5-minute check
  let costSum = 0; // what one share of every held lot cost, added up
  const days: MmDay[] = [];

  for (let d = 0; d < sessions.length; d++) {
    const { date, bars } = sessions[d];
    const sells: MmSell[] = [];
    let wholeTrail: Trail = null;

    const sell = (lot: OpenLot, price: number) => {
      sells.push({ buyPrice: lot.buyPrice, sellPrice: price, heldDays: d - lot.day });
      costSum -= lot.buyPrice;
    };
    const sellEverything = (price: number) => {
      for (const lot of armed) sell(lot, price);
      for (const lot of waiting) sell(lot, price);
      armed = [];
      waiting.length = 0;
      wholeTrail = null;
    };

    for (let b = 0; b < bars.length; b++) {
      const bar = bars[b];
      const held = waiting.length + armed.length;

      if (held > 0) {
        // 1. The whole holding first.
        const whole = stepBar(bar, costSum / held, wholeTrail, rules, worst);
        wholeTrail = whole.trail;
        if (whole.exit != null) sellEverything(whole.exit);
        else if (wholeTrail == null) {
          // 2. Lot by lot. Stops armed in an earlier bar first, then lots reaching their own trigger now.
          if (armed.length > 0) {
            const staying: OpenLot[] = [];
            for (const lot of armed) {
              const step = stepBar(bar, lot.buyPrice, lot.trail, rules, worst);
              if (step.exit == null) {
                lot.trail = step.trail;
                staying.push(lot);
              } else sell(lot, step.exit);
            }
            armed = staying;
          }
          let arming = 0;
          while (arming < waiting.length && waiting[arming].buyPrice + rules.trigger <= bar.high) arming++;
          for (const lot of waiting.splice(0, arming)) {
            const step = stepBar(bar, lot.buyPrice, null, rules, worst);
            if (step.exit == null) {
              lot.trail = step.trail;
              armed.push(lot);
            } else sell(lot, step.exit);
          }
        }
      }

      if (b === bars.length - 1) {
        // 3. Sell whatever is still armed at the close, then 4. buy the day's lot.
        if (wholeTrail != null && waiting.length + armed.length > 0) sellEverything(bar.close);
        else if (armed.length > 0) {
          for (const lot of armed) sell(lot, bar.close);
          armed = [];
        }
        insertLot(waiting, { buyPrice: bar.close, day: d, trail: null });
        costSum += bar.close;
        days.push({ date, close: bar.close, sells, buyPrice: bar.close, heldLots: waiting.length, heldCost: costSum });
      }
    }
  }
  return days;
}

/** What the account did, in rupees, for one share count and charges setting. */
export type MmRun = {
  /** Money made or lost so far at each day's close: cash from sells, less charges, plus what the held shares are worth. */
  values: number[];
  profit: number;
  /** The most money ever tied up in held shares at once (what they cost), which is what the test really needs. */
  peakCapital: number;
  /** Profit as a share of the peak capital tied up. */
  returnOnPeak: number | null;
  sells: number;
  wins: number;
  charges: number;
  maxShares: number;
  avgHoldDays: number | null;
  openLots: number;
  openShares: number;
  openCost: number;
  unrealized: number;
};

/** Every buy and sell is a delivery trade, because lots are held overnight. */
export function accountOf(days: MmDay[], { shares, withCosts }: { shares: number; withCosts: boolean }): MmRun {
  const charge = (value: number, side: 'buy' | 'sell') => (withCosts ? orderCharges(value, side, 'delivery') : 0);
  const values: number[] = [];
  let realized = 0;
  let paid = 0;
  let sells = 0;
  let wins = 0;
  let heldDays = 0;
  let peakCapital = 0;
  let maxShares = 0;

  for (const day of days) {
    // The DP charge is per stock per day, not per lot, so several sells on one day share a single one.
    const sharedDp = withCosts && day.sells.length > 1 ? CHARGES.dpChargePerSell * (day.sells.length - 1) : 0;
    let sellCharges = 0;
    for (const sold of day.sells) {
      const sellCharge = charge(shares * sold.sellPrice, 'sell');
      sellCharges += sellCharge;
      const own = charge(shares * sold.buyPrice, 'buy') + sellCharge - sharedDp / day.sells.length;
      realized += shares * (sold.sellPrice - sold.buyPrice);
      if (shares * (sold.sellPrice - sold.buyPrice) - own > 0) wins++;
      heldDays += sold.heldDays;
      sells++;
    }
    paid += sellCharges - sharedDp + charge(shares * day.buyPrice, 'buy');
    peakCapital = Math.max(peakCapital, shares * day.heldCost);
    maxShares = Math.max(maxShares, shares * day.heldLots);
    values.push(realized - paid + shares * (day.heldLots * day.close - day.heldCost));
  }

  const last = days[days.length - 1];
  const openCost = shares * last.heldCost;
  return {
    values,
    profit: values[values.length - 1],
    peakCapital,
    returnOnPeak: peakCapital > 0 ? values[values.length - 1] / peakCapital : null,
    sells,
    wins,
    charges: paid,
    maxShares,
    avgHoldDays: sells > 0 ? heldDays / sells : null,
    openLots: last.heldLots,
    openShares: shares * last.heldLots,
    openCost,
    unrealized: shares * last.heldLots * last.close - openCost,
  };
}

export type MarginMaximusResult = {
  dates: string[];
  shares: number;
  rule: TrailRule;
  /** Profit or loss from buying the same number of shares on the first day and holding them to the end. */
  holding: number[];
  best: MmRun;
  worst: MmRun;
  /** Days skipped because the price jumped over 30%, usually a split Yahoo hasn't adjusted. */
  skippedDays: number;
};

export type MmOptions = { shares: number; withCosts: boolean; trail: TrailKey };
/** from: first trading day to include (YYYY-MM-DD), or null for all history. */
export type MmDailyOptions = MmOptions & { from: string | null };

/** Runs the strategy twice over the same bars, once assuming the best order inside each bar and once the worst. */
export function marginMaximus(sessions: MmSession[], options: MmOptions, skippedDays = 0): MarginMaximusResult | null {
  if (sessions.length < 2) return null;
  const rule = trailRule(options.trail);
  const closes = sessions.map((session) => session.bars[session.bars.length - 1].close);
  return {
    dates: sessions.map((session) => session.date),
    shares: options.shares,
    rule,
    holding: closes.map((close) => options.shares * (close - closes[0])),
    best: accountOf(planTrades(sessions, rule, false), options),
    worst: accountOf(planTrades(sessions, rule, true), options),
    skippedDays,
  };
}

/** One bar per trading day from the ~10-year daily history, skipping holiday placeholder rows and unadjusted jumps. */
export function dailySessions(history: HistoryFile, from: string | null): { sessions: MmSession[]; skippedDays: number } {
  const rows = history.rows.filter((row) => row[6] > 0 && row[1] > 0 && row[4] > 0 && (from == null || row[0] >= from));
  const sessions: MmSession[] = [];
  let skippedDays = 0;
  let previousClose: number | null = null;

  for (const [date, open, high, low, close] of rows) {
    // A jump over 30% is almost always a split Yahoo hasn't adjusted; trading on it would be made-up money.
    const jumped = previousClose != null && Math.abs(Math.log(close / previousClose)) > SUSPICIOUS_LOG_MOVE;
    previousClose = close;
    if (jumped) skippedDays++;
    else sessions.push({ date, bars: [{ open, high, low, close }] });
  }
  return { sessions, skippedDays };
}

export function marginMaximusTest(history: HistoryFile, { from, ...options }: MmDailyOptions): MarginMaximusResult | null {
  const { sessions, skippedDays } = dailySessions(history, from);
  return marginMaximus(sessions, options, skippedDays);
}

/** The same rules bar by bar on 5-minute prices, dropping today's session while it is still trading. */
export function marginMaximusIntraday(history: IntradayHistory, options: MmOptions): MarginMaximusResult | null {
  const sessions = completedSessions(history)
    .filter((session) => session.bars.length > 0)
    .map((session) => ({
      date: session.date,
      bars: session.bars.map(([, open, high, low, close]) => ({ open, high, low, close })),
    }));
  return marginMaximus(sessions, options);
}

/**
 * public/research/margin-maximus.json: results per stock for every share count, period and stop rule.
 * Whole rupees, and both charges settings share a row, to keep the file small.
 */
export type MmSummaryRow = [
  peakCapital: number,
  holding: number,
  worstBeforeCharges: number,
  bestBeforeCharges: number,
  worstAfterCharges: number,
  bestAfterCharges: number,
];

export type MarginMaximusSummary = {
  generatedAt: string;
  stocks: { symbol: string; name: string; results: Record<string, MmSummaryRow> }[];
};

export const marginMaximusKey = (shares: number, period: PeriodKey, trail: TrailKey) => `${shares}|${period}|${trail}`;

/** The worst and best case from a summary row, for the charges setting in use. */
export const summaryRange = (row: MmSummaryRow, withCosts: boolean) => (withCosts ? [row[4], row[5]] : [row[2], row[3]]);
