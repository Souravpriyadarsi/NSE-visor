import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { GrowthChart } from '../components/GrowthChart.tsx';
import { IntradayChart, type ChartLevel, type ChartMark } from '../components/IntradayChart.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { usePriceSource } from '../hooks/useAngel.ts';
import { useIntraday, type IntradayState } from '../hooks/useIntraday.ts';
import { useLocalStorageState } from '../hooks/useLocalStorageState.ts';
import { useNow } from '../hooks/useNow.ts';
import {
  advanceBot,
  BOT_SHARE_CHOICES,
  DEFAULT_BOT_STATE,
  liveView,
  MAX_BOT_STOCKS,
  ORDER_REASONS,
  parseBotState,
  stopBot,
  type BotLot,
  type BotOrder,
  type BotSettings,
  type BotState,
  type LiveView,
} from '../lib/algo/mmBot.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import type { IntradayRange } from '../lib/data/loadIntraday.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPrice } from '../lib/format.ts';
import { completedSessions, istDate, istMinute, istTime, isMarketOpen, MARKET_CLOSE_MINUTE } from '../lib/intraday/bars.ts';
import { TRAIL_RULES, trailRule } from '../lib/tests/marginMaximus.ts';

type Props = { options: PickerOption[] };

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
/** How long the bot can go unopened before it needs Yahoo's 60 days of 5-minute prices to catch up. */
const SHORT_RANGE_SECONDS = 4 * 86400;
const ORDERS_SHOWN = 200;

export function AlgoTradingTab({ options }: Props) {
  const stockOptions = useMemo(() => options.filter((o) => !o.symbol.startsWith('^')), [options]);
  const [state, setState] = useLocalStorageState<BotState>('nse-visor:algo-bot', DEFAULT_BOT_STATE, parseBotState);

  return (
    <div className="space-y-6">
      <AlgoBot options={stockOptions} state={state} setState={setState} />
      <HowItWorks settings={state.settings} />
    </div>
  );
}

type BotProps = { options: PickerOption[]; state: BotState; setState: (update: (s: BotState) => BotState) => void };

function AlgoBot({ options, state, setState }: BotProps) {
  const { settings } = state;
  const [confirm, setConfirm] = useState<'stop' | 'reset' | null>(null);
  const now = useNow(15_000);
  const nowSeconds = Math.floor(now / 1000);
  const running = state.startedAt != null;
  const marketOpen = isMarketOpen(new Date(now));
  const afterClose = istMinute(nowSeconds) >= MARKET_CLOSE_MINUTE;
  const rule = trailRule(settings.trail);

  const behind = running ? nowSeconds - Math.max(state.startedAt!, state.processedUntil ?? 0) : 0;
  const range: IntradayRange = behind > SHORT_RANGE_SECONDS ? '60d' : '5d';
  const source = usePriceSource();
  const histories = useIntraday(running ? settings.symbols : [], range, running, source);
  const loaded = settings.symbols.map((symbol) => histories[symbol]).filter((h): h is Extract<IntradayState, { status: 'ready' }> => h?.status === 'ready');
  const allReady = running && loaded.length === settings.symbols.length;
  // A new list only when fresh prices arrive, so the bot isn't re-run on every clock tick.
  const readyKey = loaded.map((h) => `${h.history.symbol}@${h.fetchedAt}`).join(',');
  const readyHistories = useMemo(() => loaded.map((h) => h.history), [readyKey]);

  // Trade every finished day the bot hasn't seen yet. It's a replay, so a missed day is caught up on the next visit.
  useEffect(() => {
    if (allReady) setState((s) => advanceBot(s, readyHistories, nowSeconds));
  }, [allReady, readyHistories, nowSeconds, setState]);

  const views: Record<string, LiveView | null> = {};
  for (const history of readyHistories) views[history.symbol] = running ? liveView(state, history, nowSeconds) : null;

  // Today's sells so far aren't booked until the close, but they count towards what the account is worth now.
  const liveSells = Object.values(views).flatMap((v) => v?.sells ?? []);
  const heldNow = (symbol: string): BotLot[] => views[symbol]?.held ?? state.lots[symbol] ?? [];
  const priceNow = (symbol: string) => views[symbol]?.lastPrice ?? state.lastPrice[symbol];
  const cashNow = state.cash + liveSells.reduce((sum, o) => sum + o.shares * o.price - o.charges, 0);
  const symbolsHeld = [...new Set([...settings.symbols, ...Object.keys(state.lots)])];
  const allLots = symbolsHeld.flatMap((symbol) => heldNow(symbol).map((lot) => ({ symbol, lot })));
  const sharesValue = allLots.reduce((sum, { symbol, lot }) => sum + lot.shares * (priceNow(symbol) ?? lot.buyPrice), 0);
  const sharesCost = allLots.reduce((sum, { lot }) => sum + lot.shares * lot.buyPrice, 0);
  const accountValue = cashNow + sharesValue;
  const profit = accountValue - settings.startingCash;
  const orders = [...state.orders, ...liveSells];
  const sells = orders.filter((o) => o.side === 'sell');
  const charges = orders.reduce((sum, o) => sum + o.charges, 0);
  const fresh = state.orders.length === 0 && state.days.length === 0;
  const lastUpdate = Math.max(0, ...loaded.map((h) => h.fetchedAt));

  const changeSettings = (change: Partial<BotSettings>) =>
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...change },
      ...(change.startingCash != null && s.orders.length === 0 ? { cash: change.startingCash } : {}),
    }));
  const start = () => setState((s) => ({ ...s, startedAt: Math.floor(Date.now() / 1000) }));
  const stop = () => setState((s) => stopBot(s, readyHistories, Math.floor(Date.now() / 1000)));
  const reset = () => setState((s) => ({ ...DEFAULT_BOT_STATE, settings: s.settings, cash: s.settings.startingCash }));

  const status = running
    ? marketOpen
      ? 'Running · watching live prices'
      : afterClose
        ? "Running · today's close is booked once the last 5-minute bar is in"
        : 'Running · waits for the market to open'
    : 'Stopped';

  return (
    <Card
      title="Minimal Margin Maximus bot"
      subtitle="Trades pretend money with the Tests tab's Minimal Margin Maximus rules on live 5-minute prices, including a broker's delivery charges. It's a replay of real prices, so it keeps its place when you close the page: reopening it trades every day it missed (up to 60 days back)."
    >
      {running ? (
        <p className="text-sm text-ink-300">
          Buying {settings.shares} {settings.shares === 1 ? 'share' : 'shares'} of {settings.symbols.map(displaySymbol).join(', ')} at every close ·{' '}
          {rule.label} · started {formatDate(istDate(state.startedAt!))} {istTime(state.startedAt!)}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {settings.symbols.length < MAX_BOT_STOCKS && (
              <StockPicker
                options={options.filter((o) => !settings.symbols.includes(o.symbol))}
                onSelect={(symbol) => !settings.symbols.includes(symbol) && changeSettings({ symbols: [...settings.symbols, symbol] })}
                placeholder={`Add up to ${MAX_BOT_STOCKS} stocks`}
              />
            )}
            {settings.symbols.map((symbol) => (
              <span key={symbol} className="flex items-center gap-1 rounded-full border border-ink-700 bg-ink-800/60 py-0.5 pr-1 pl-2.5 text-xs text-ink-200">
                {displaySymbol(symbol)}
                <button
                  type="button"
                  aria-label={`Remove ${displaySymbol(symbol)}`}
                  onClick={() => changeSettings({ symbols: settings.symbols.filter((s) => s !== symbol) })}
                  className="rounded-full px-1 text-ink-400 hover:text-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              label="Shares per day"
              value={settings.shares}
              choices={BOT_SHARE_CHOICES.map((n) => ({ value: n, label: `${n} ${n === 1 ? 'share' : 'shares'}` }))}
              onChange={(shares) => changeSettings({ shares })}
            />
            <Toggle
              label="Trigger and trail"
              value={settings.trail}
              choices={TRAIL_RULES.map((r) => ({ value: r.key, label: r.label }))}
              onChange={(trail) => changeSettings({ trail })}
            />
            {fresh ? (
              <label className="flex items-center gap-2 text-xs text-ink-400">
                Starting cash ₹
                <input
                  key={settings.startingCash}
                  type="number"
                  min={10000}
                  step={10000}
                  defaultValue={settings.startingCash}
                  onBlur={(e) => {
                    const value = Math.round(Number(e.target.value));
                    if (value >= 10000 && value !== settings.startingCash) changeSettings({ startingCash: value });
                  }}
                  className="w-32 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
                />
              </label>
            ) : (
              <span className="text-xs text-ink-400">Cash carried over: {rupees(state.cash)}</span>
            )}
          </div>
          <p className="text-xs text-ink-500">
            Each stock buys {settings.shares} {settings.shares === 1 ? 'share' : 'shares'} every trading day, so the money tied up keeps growing while
            prices fall. A buy is skipped when the cash runs out.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <button
            type="button"
            onClick={() => (confirm === 'stop' ? (stop(), setConfirm(null)) : setConfirm('stop'))}
            onBlur={() => setConfirm(null)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500"
          >
            {confirm === 'stop' ? 'Click again to sell everything and stop' : 'Stop and sell everything'}
          </button>
        ) : (
          <button
            type="button"
            disabled={settings.symbols.length === 0}
            onClick={start}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start the bot
          </button>
        )}
        <span className="flex items-center gap-2 text-xs text-ink-400">
          <span className={`inline-block h-2 w-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-ink-600'}`} />
          {status}
          {lastUpdate > 0 && ` · ${source === 'angel' ? 'Angel One' : 'Yahoo'} prices from ${istTime(Math.floor(lastUpdate / 1000))}`}
        </span>
      </div>

      {!fresh && (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Account value', value: rupees(accountValue), className: '' },
            { label: 'Profit or loss', value: signedRupees(profit), className: tone(profit) },
            { label: 'Cash', value: rupees(cashNow), className: '' },
            { label: 'In shares (cost)', value: rupees(sharesCost), className: '' },
            { label: 'Sells, winners', value: `${sells.length}, ${sells.filter((o) => (o.pnl ?? 0) > 0).length}`, className: '' },
            { label: 'Charges paid', value: rupees(charges), className: '' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2">
              <dt className="text-[11px] text-ink-400">{stat.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${stat.className}`}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {running && (
        <div className="mt-4 space-y-4">
          {settings.symbols.map((symbol) => (
            <StockPanel
              key={symbol}
              symbol={symbol}
              loaded={histories[symbol]}
              view={views[symbol] ?? null}
              lots={heldNow(symbol)}
              price={priceNow(symbol)}
              orders={orders}
              trigger={rule.trigger}
            />
          ))}
        </div>
      )}

      {state.days.length > 1 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink-100">Account value at each close</h3>
          <div className="mt-2">
            <GrowthChart
              dates={state.days.map((d) => d.date)}
              lines={[
                { label: 'Account value', color: CHART_COLORS.forecast, values: state.days.map((d) => d.value) },
                { label: 'Starting cash', color: CHART_COLORS.guide, values: state.days.map(() => settings.startingCash) },
              ]}
              format={rupees}
            />
          </div>
        </>
      )}

      <OrdersTable orders={orders} liveCount={liveSells.length} />
      <DailyRecord state={state} />

      {!running && !fresh && (
        <button
          type="button"
          onClick={() => (confirm === 'reset' ? (reset(), setConfirm(null)) : setConfirm('reset'))}
          onBlur={() => setConfirm(null)}
          className="mt-4 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-400 hover:border-rose-500/50 hover:text-rose-300"
        >
          {confirm === 'reset' ? 'Click again to erase the account and its record' : 'Reset the account'}
        </button>
      )}
    </Card>
  );
}

type StockPanelProps = {
  symbol: string;
  loaded: IntradayState | undefined;
  view: LiveView | null;
  lots: BotLot[];
  price: number | undefined;
  orders: BotOrder[];
  trigger: number;
};

function StockPanel({ symbol, loaded, view, lots, price, orders, trigger }: StockPanelProps) {
  const format = (value: number) => formatPrice(value, symbol);
  const shares = lots.reduce((sum, lot) => sum + lot.shares, 0);
  const cost = lots.reduce((sum, lot) => sum + lot.shares * lot.buyPrice, 0);
  const average = shares > 0 ? cost / shares : null;
  const unrealized = price != null ? shares * price - cost : 0;
  const history = loaded?.status === 'ready' ? loaded.history : null;
  // Today's bars while trading; otherwise the latest finished day, to show what the bot did.
  const session = view?.session ?? (history ? completedSessions(history).at(-1) : undefined);

  const marks: ChartMark[] = useMemo(
    () =>
      session
        ? orders
            .filter((o) => o.symbol === symbol && o.date === session.date)
            .map((o) => ({ time: o.time, side: o.side, text: `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.shares}` }))
        : [],
    [orders, symbol, session],
  );
  const levels: ChartLevel[] = [];
  if (view?.wholeStop != null) levels.push({ price: view.wholeStop, title: 'stop (all)', tone: 'fall' });
  else if (average != null) {
    levels.push({ price: average + trigger, title: 'sell-all trigger', tone: 'rise' });
    if (lots.length > 1) levels.push({ price: lots[0].buyPrice + trigger, title: 'cheapest lot trigger', tone: 'guide' });
    const highestStop = Math.max(...(view?.armed.map((a) => a.stop) ?? []));
    if (Number.isFinite(highestStop)) levels.push({ price: highestStop, title: `stop (${view!.armed.length} lot${view!.armed.length > 1 ? 's' : ''})`, tone: 'fall' });
  }

  return (
    <div className="rounded-lg border border-ink-800 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-100">
          {displaySymbol(symbol)}
          {price != null && <span className="ml-2 text-xs font-normal text-ink-400 tabular-nums">{format(price)}</span>}
        </p>
        <p className="text-xs text-ink-400 tabular-nums">
          {shares > 0 ? (
            <>
              {shares} shares in {lots.length} {lots.length === 1 ? 'lot' : 'lots'} · average {format(average!)} ·{' '}
              <span className={tone(unrealized)}>{signedRupees(unrealized)}</span>
              {view?.wholeStop != null && ` · sells everything below ${format(view.wholeStop)}`}
              {view && view.wholeStop == null && view.armed.length > 0 && ` · ${view.armed.length} armed`}
            </>
          ) : (
            'Nothing held yet: the first buy is at the close'
          )}
        </p>
      </div>
      {!loaded || loaded.status === 'loading' ? (
        <div className="mt-2 h-[320px] animate-pulse rounded-lg bg-ink-800/40" />
      ) : loaded.status === 'error' ? (
        <p className="mt-2 text-sm text-rose-300">{loaded.message}</p>
      ) : !session ? (
        <p className="mt-2 text-sm text-ink-400">No 5-minute prices yet.</p>
      ) : (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-ink-500">{view ? 'Today so far' : formatDate(session.date)}</p>
          <IntradayChart bars={session.bars} trades={[]} format={format} marks={marks} levels={levels} />
        </div>
      )}
    </div>
  );
}

function OrdersTable({ orders, liveCount }: { orders: BotOrder[]; liveCount: number }) {
  const recent = [...orders].sort((a, b) => b.time - a.time).slice(0, ORDERS_SHOWN);
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold text-ink-100">Orders</h3>
      {recent.length === 0 ? (
        <p className="mt-1 text-sm text-ink-400">No paper orders yet. The bot's first buy is at the next close.</p>
      ) : (
        <>
          {liveCount > 0 && <p className="mt-1 text-xs text-ink-500">Today's sells so far are booked for good at the close.</p>}
          <div className="scroll-area mt-2 max-h-96">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-xs text-ink-400">
                  <th className="py-2 pr-3 text-left font-medium">When</th>
                  <th className="py-2 pr-3 text-left font-medium">Stock</th>
                  <th className="py-2 pr-3 text-left font-medium">Order</th>
                  <th className="py-2 pr-3 text-right font-medium">Shares</th>
                  <th className="py-2 pr-3 text-right font-medium">Price</th>
                  <th className="py-2 pr-3 text-left font-medium">Why</th>
                  <th className="py-2 pr-3 text-right font-medium">Charges</th>
                  <th className="py-2 pr-3 text-right font-medium">Profit after charges</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o, i) => (
                  <tr key={`${o.symbol}-${o.time}-${o.side}-${i}`} className="border-t border-ink-800">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-ink-400">
                      {formatDate(o.date)} {istTime(o.time)}
                    </td>
                    <td className="py-2 pr-3 text-ink-100">{displaySymbol(o.symbol)}</td>
                    <td className={`py-2 pr-3 ${o.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>{o.side === 'buy' ? 'Buy' : 'Sell'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{o.shares}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPrice(o.price, o.symbol)}</td>
                    <td className="py-2 pr-3 text-ink-400">{ORDER_REASONS[o.reason]}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(o.charges)}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${tone(o.pnl)}`}>{o.pnl == null ? '—' : signedRupees(o.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orders.length > ORDERS_SHOWN && <p className="mt-1 text-xs text-ink-500">Showing the latest {ORDERS_SHOWN} of {orders.length} orders.</p>}
        </>
      )}
    </>
  );
}

function DailyRecord({ state }: { state: BotState }) {
  const { days, settings } = state;
  if (days.length === 0) return null;
  const rows = days.map((day, i) => ({ ...day, change: day.value - (i > 0 ? days[i - 1].value : settings.startingCash) }));
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold text-ink-100">Daily record</h3>
      <div className="scroll-area mt-2 max-h-96">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-ink-900">
            <tr className="text-xs text-ink-400">
              <th className="py-2 pr-3 text-left font-medium">Date</th>
              <th className="py-2 pr-3 text-right font-medium">Buys</th>
              <th className="py-2 pr-3 text-right font-medium">Sells</th>
              <th className="py-2 pr-3 text-right font-medium">Charges</th>
              <th className="py-2 pr-3 text-right font-medium">Booked profit</th>
              <th className="py-2 pr-3 text-right font-medium">Shares held</th>
              <th className="py-2 pr-3 text-right font-medium">Account value</th>
              <th className="py-2 pr-3 text-right font-medium">Day's change</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((day) => (
              <tr key={day.date} className="border-t border-ink-800">
                <td className="py-2 pr-3 whitespace-nowrap">{formatDate(day.date)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {day.buys}
                  {day.skipped > 0 && <span className="ml-1 text-xs text-orange-300">({day.skipped} skipped, no cash)</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{day.sells}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(day.charges)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${tone(day.realized)}`}>{day.sells > 0 ? signedRupees(day.realized) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{day.heldShares}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{rupees(day.value)}</td>
                <td className={`py-2 pr-3 text-right font-medium tabular-nums ${tone(day.change)}`}>{signedRupees(day.change)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HowItWorks({ settings }: { settings: BotSettings }) {
  const rule = trailRule(settings.trail);
  return (
    <Card title="How the bot trades" subtitle="The same rules as the Minimal Margin Maximus test on the Tests tab, run on live prices.">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-300">
        <li>
          <strong className="text-ink-100">Every close it buys</strong> {settings.shares} {settings.shares === 1 ? 'share' : 'shares'} of each stock at
          the closing price, as a delivery trade, if there's enough cash.
        </li>
        <li>
          <strong className="text-ink-100">The whole holding first.</strong> When the price reaches the average buy price of everything held plus ₹
          {rule.trigger}, a trailing stop arms for all of it and sells when the price falls ₹{rule.trail} below its high.
        </li>
        <li>
          <strong className="text-ink-100">Otherwise lot by lot.</strong> A single day's lot whose own buy price + ₹{rule.trigger} is reached gets the
          same trailing stop, so cheaper lots take their profit while the rest wait.
        </li>
        <li>
          <strong className="text-ink-100">Armed stops that haven't sold by the close</strong> sell at the close, before that day's buy.
        </li>
        <li>
          <strong className="text-ink-100">There is no stop-loss.</strong> Lots that never reach their trigger are held, and buying carries on, so the
          holding grows while prices fall.
        </li>
      </ol>
      <p className="mt-3 text-xs text-ink-500">
        Prices come in 5-minute bars, which only say how high and low the price went, not in which order. The bot always assumes the less favourable
        order (the Tests tab's worst case), so live fills with a real feed would usually be a little better. Charges are Zerodha's published delivery
        rates, with one depository charge per stock per day. Stopping the bot sells every held share at the latest price.
      </p>
    </Card>
  );
}
