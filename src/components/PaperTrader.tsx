import { useEffect, useMemo, useState } from 'react';
import { Card } from './Card.tsx';
import { IntradayChart } from './IntradayChart.tsx';
import { StockPicker, type PickerOption } from './StockPicker.tsx';
import { Toggle } from './Toggle.tsx';
import { usePriceSource } from '../hooks/useAngel.ts';
import { useIntraday } from '../hooks/useIntraday.ts';
import { useLocalStorageState } from '../hooks/useLocalStorageState.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { istDate, istMinute, istTime, isMarketOpen, MARKET_CLOSE_MINUTE } from '../lib/intraday/bars.ts';
import type { IntradayResearch } from '../lib/intraday/evaluate.ts';
import {
  DEFAULT_PAPER_STATE,
  MAX_PAPER_STOCKS,
  PAPER_MIN_DAYS,
  paperDay,
  parsePaperState,
  summarizeDay,
  type PaperDay,
  type PaperSettings,
  type PaperState,
} from '../lib/intraday/paper.ts';
import { DEFAULT_RISK, RISK_PER_TRADE_CHOICES, riskLabel } from '../lib/intraday/risk.ts';
import { REASON_LABELS } from '../lib/intraday/simulator.ts';
import { STRATEGIES, STRATEGY_SHORT_NAMES, strategyById } from '../lib/intraday/strategies.ts';

type Props = { options: PickerOption[]; research: IntradayResearch | null };

type LogRow = { key: string; time: number; symbol: string; action: string; qty: number; price: number; note: string; pnl: number | null };

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const tone = (value: number) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
const nowSecondsOf = () => Math.floor(Date.now() / 1000);

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PaperTrader({ options, research }: Props) {
  const [state, setState] = useLocalStorageState<PaperState>('nse-visor:paper-trader', DEFAULT_PAPER_STATE, parsePaperState);
  const [confirmReset, setConfirmReset] = useState(false);
  const now = useNow(15_000);
  const nowSeconds = Math.floor(now / 1000);
  const today = istDate(nowSeconds);
  const afterClose = istMinute(nowSeconds) >= MARKET_CLOSE_MINUTE;
  const marketOpen = isMarketOpen(new Date(now));

  const { settings, windows, record } = state;
  const running = windows.some((w) => w.until == null);
  const lastStop = windows.length ? windows[windows.length - 1] : null;
  const activeToday = windows.some((w) => w.until == null || istDate(w.until) === today);
  const source = usePriceSource();
  const histories = useIntraday(settings.symbols, '5d', activeToday && !afterClose, source);
  const strategy = strategyById(settings.strategy);
  const researchFor = (symbol: string) => research?.stocks.find((s) => s.symbol === symbol)?.results[settings.strategy];

  const days = settings.symbols.map((symbol) => {
    const loaded = histories[symbol];
    return { symbol, loaded, day: loaded.status === 'ready' ? paperDay(loaded.history, today, settings, windows, !afterClose) : null };
  });

  // Add each finished trading day the trader was on to the track record.
  useEffect(() => {
    const loaded = settings.symbols.map((symbol) => histories[symbol]);
    if (loaded.length === 0 || loaded.some((h) => h.status !== 'ready')) return;
    const ready = loaded.map((h) => (h.status === 'ready' ? h.history : null)!);
    const additions: PaperDay[] = [];
    for (const session of ready[0].sessions) {
      const finished = session.date < today || (session.date === today && afterClose);
      if (!finished || record.some((r) => r.date === session.date)) continue;
      const dayStart = session.bars[0][0];
      const dayEnd = session.bars[session.bars.length - 1][0] + 300;
      if (!windows.some((w) => w.from <= dayEnd && (w.until == null || w.until >= dayStart))) continue;
      const results = ready.flatMap((history) => {
        const day = paperDay(history, session.date, settings, windows, false);
        return day ? [day.result] : [];
      });
      additions.push(summarizeDay(session.date, settings, results));
    }
    if (additions.length) {
      setState((s) => ({ ...s, record: [...s.record, ...additions].sort((a, b) => a.date.localeCompare(b.date)) }));
    }
  }, [histories, settings, windows, record, today, afterClose, setState]);

  const stockOptions = useMemo(() => options.filter((o) => !settings.symbols.includes(o.symbol)), [options, settings.symbols]);

  // Changing settings would change how today's earlier trades replay, so today's on/off times are cleared.
  const changeSettings = (change: Partial<PaperSettings>) =>
    setState((s) => ({
      ...s,
      settings: { ...s.settings, ...change },
      windows: s.windows.filter((w) => w.until != null && istDate(w.until) < istDate(nowSecondsOf())),
    }));

  const start = () =>
    setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        params: Object.fromEntries(s.settings.symbols.map((symbol) => [symbol, researchFor(symbol)?.params ?? strategy.grid[0]])),
      },
      windows: [...s.windows, { from: nowSecondsOf(), until: null }],
    }));

  const stop = (kill: boolean) =>
    setState((s) => ({
      ...s,
      windows: s.windows.map((w) => (w.until == null ? { ...w, until: nowSecondsOf(), ...(kill ? { kill: true } : {}) } : w)),
    }));

  const trades = days.flatMap((d) => d.day?.result.trades ?? []);
  const openPositions = days.flatMap((d) => (d.day?.result.open ? [d.day.result.open] : []));
  const todayNet =
    trades.reduce((sum, t) => sum + t.net, 0) + openPositions.reduce((sum, p) => sum + p.unrealized - p.entryCharges, 0);
  const todayCharges = trades.reduce((sum, t) => sum + t.charges, 0) + openPositions.reduce((sum, p) => sum + p.entryCharges, 0);
  const lastUpdate = Math.max(0, ...days.map((d) => (d.loaded.status === 'ready' ? d.loaded.fetchedAt : 0)));

  const log: LogRow[] = [];
  for (const t of trades) {
    log.push({ key: `${t.symbol}-${t.entryTime}-in`, time: t.entryTime, symbol: t.symbol, action: t.side === 1 ? 'Buy' : 'Sell short', qty: t.qty, price: t.entryPrice, note: '', pnl: null });
    log.push({ key: `${t.symbol}-${t.entryTime}-out`, time: t.exitTime, symbol: t.symbol, action: t.side === 1 ? 'Sell' : 'Buy back', qty: t.qty, price: t.exitPrice, note: REASON_LABELS[t.reason], pnl: t.net });
  }
  for (const p of openPositions) {
    log.push({ key: `${p.symbol}-${p.entryTime}-in`, time: p.entryTime, symbol: p.symbol, action: p.side === 1 ? 'Buy' : 'Sell short', qty: p.qty, price: p.entryPrice, note: 'Open', pnl: null });
  }
  log.sort((a, b) => b.time - a.time);

  const failing = settings.symbols.filter((s) => researchFor(s) && !researchFor(s)!.pass);
  const untested = research ? settings.symbols.filter((s) => !researchFor(s)) : [];
  const totalNet = record.reduce((sum, r) => sum + r.net, 0);
  const worstDay = record.length ? Math.min(...record.map((r) => r.net)) : 0;
  const checks = [
    {
      ok: settings.symbols.length > 0 && settings.symbols.every((s) => researchFor(s)?.pass),
      label: `${strategy.name} passed the backtest on unseen days for every chosen stock`,
    },
    { ok: record.length >= PAPER_MIN_DAYS, label: `At least ${PAPER_MIN_DAYS} paper trading days (${record.length} so far)` },
    { ok: record.length > 0 && totalNet > 0, label: 'Made money overall after charges' },
    {
      ok: record.length > 0 && worstDay >= -DEFAULT_RISK.dailyLossLimit * settings.capital,
      label: `No day lost more than ${formatPct(DEFAULT_RISK.dailyLossLimit)} of capital`,
    },
  ];

  const status = running
    ? marketOpen
      ? 'Running'
      : afterClose
        ? 'Running · market closed for today'
        : 'Running · waits for the market to open'
    : 'Stopped';

  return (
    <Card
      title="Paper trader"
      subtitle="Trades pretend money on live 5-minute prices, with exactly the backtest's rules, charges and limits. It runs while this page is open and checks for new prices every minute in market hours; if you close the page, reopening it replays the day and catches up."
    >
      {running ? (
        <p className="text-sm text-ink-300">
          {strategy.name} on {settings.symbols.map(displaySymbol).join(', ')} · {rupees(settings.capital)} split equally · risk {riskLabel(settings.riskPerTrade)}{' '}
          per trade · {settings.allowShort ? 'long and short' : 'long only'}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {settings.symbols.length < MAX_PAPER_STOCKS && (
              <StockPicker
                options={stockOptions}
                onSelect={(symbol) => !settings.symbols.includes(symbol) && changeSettings({ symbols: [...settings.symbols, symbol] })}
                placeholder={`Add up to ${MAX_PAPER_STOCKS} stocks`}
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
              label="Strategy"
              value={settings.strategy}
              choices={STRATEGIES.map((s) => ({ value: s.id, label: STRATEGY_SHORT_NAMES[s.id] }))}
              onChange={(id) => changeSettings({ strategy: id })}
            />
            <Toggle
              label="Risk per trade"
              value={settings.riskPerTrade}
              choices={RISK_PER_TRADE_CHOICES.map((r) => ({ value: r, label: `Risk ${riskLabel(r)}` }))}
              onChange={(riskPerTrade) => changeSettings({ riskPerTrade })}
            />
            <Toggle
              label="Direction"
              value={settings.allowShort ? 'both' : 'long'}
              choices={[
                { value: 'both', label: 'Long and short' },
                { value: 'long', label: 'Long only' },
              ]}
              onChange={(choice) => changeSettings({ allowShort: choice === 'both' })}
            />
            <label className="flex items-center gap-2 text-xs text-ink-400">
              Capital ₹
              <input
                key={settings.capital}
                type="number"
                min={10000}
                step={10000}
                defaultValue={settings.capital}
                onBlur={(e) => {
                  const value = Math.round(Number(e.target.value));
                  if (value >= 10000 && value !== settings.capital) changeSettings({ capital: value });
                }}
                className="w-28 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
              />
            </label>
          </div>
          {failing.length > 0 && (
            <p className="text-xs text-orange-300">
              {strategy.name} didn't pass the backtest for {failing.map(displaySymbol).join(', ')}. Paper trading them shows how that plays out live.
            </p>
          )}
          {untested.length > 0 && (
            <p className="text-xs text-ink-400">
              {untested.map(displaySymbol).join(', ')} {untested.length === 1 ? "isn't" : "aren't"} in the nightly NIFTY 50 backtest, so they use the
              strategy's default settings. Test them in the lab above first.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <>
            <button type="button" onClick={() => stop(false)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-100 hover:bg-ink-800">
              Stop new trades
            </button>
            <button type="button" onClick={() => stop(true)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500">
              Kill switch: exit everything
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={settings.symbols.length === 0}
            onClick={start}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start paper trading
          </button>
        )}
        <span className="flex items-center gap-2 text-xs text-ink-400">
          <span className={`inline-block h-2 w-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-ink-600'}`} />
          {status}
          {lastUpdate > 0 && ` · ${source === 'angel' ? 'Angel One' : 'Yahoo'} prices from ${istTime(Math.floor(lastUpdate / 1000))}`}
        </span>
      </div>
      {!running && lastStop && istDate(lastStop.until!) === today && (
        <p className="mt-2 text-xs text-ink-500">
          {lastStop.kill
            ? `Kill switch used at ${istTime(lastStop.until!)}: every open position was closed at the last price.`
            : 'Stopped: no new trades, but open positions are still managed until their stop, target or 15:15.'}{' '}
          Changing settings clears today's paper trades.
        </p>
      )}

      {settings.symbols.length > 0 && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Today's P&L after charges", value: signedRupees(todayNet), className: tone(todayNet) },
              { label: 'Trades today', value: String(trades.length + openPositions.length), className: '' },
              { label: 'Open positions', value: String(openPositions.length), className: '' },
              { label: 'Charges today', value: rupees(todayCharges), className: '' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2">
                <dt className="text-[11px] text-ink-400">{stat.label}</dt>
                <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${stat.className}`}>{stat.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 space-y-4">
            {days.map(({ symbol, loaded, day }) => {
              const format = (value: number) => formatPrice(value, symbol);
              const result = day?.result;
              const open = result?.open;
              const params = settings.params[symbol];
              return (
                <div key={symbol} className="rounded-lg border border-ink-800 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink-100">
                      {displaySymbol(symbol)}
                      {params && <span className="ml-2 text-xs font-normal text-ink-500">{strategy.describe(params)}</span>}
                    </p>
                    <p className="text-xs text-ink-400 tabular-nums">
                      {open ? (
                        <>
                          {open.side === 1 ? 'Long' : 'Short'} {open.qty} at {format(open.entryPrice)} · stop {format(open.stop)}
                          {open.target != null && ` · target ${format(open.target)}`} ·{' '}
                          <span className={tone(open.unrealized)}>{signedRupees(open.unrealized)}</span>
                        </>
                      ) : result?.pending ? (
                        `${result.pending.side === 1 ? 'Buy' : 'Short'} order for the next bar's open`
                      ) : result?.halted ? (
                        <span className="text-orange-300">Done for today: daily loss limit reached</span>
                      ) : (
                        'No open position'
                      )}
                    </p>
                  </div>
                  {loaded.status === 'loading' ? (
                    <div className="mt-2 h-[320px] animate-pulse rounded-lg bg-ink-800/40" />
                  ) : loaded.status === 'error' ? (
                    <p className="mt-2 text-sm text-rose-300">{loaded.message}</p>
                  ) : !day ? (
                    <p className="mt-2 text-sm text-ink-400">No prices for today yet. The first 5-minute bar is complete at 09:20 on trading days.</p>
                  ) : (
                    <div className="mt-2">
                      <IntradayChart
                        bars={day.data.sessions[day.session].bars}
                        vwap={day.data.vwap.slice(day.data.sessionStart[day.session])}
                        trades={day.result.trades}
                        open={open}
                        format={format}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 className="mt-6 text-sm font-semibold text-ink-100">Today's orders</h3>
          {log.length === 0 ? (
            <p className="mt-1 text-sm text-ink-400">No paper orders today.</p>
          ) : (
            <div className="scroll-area mt-2 max-h-80">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-ink-900">
                  <tr className="text-xs text-ink-400">
                    <th className="py-2 pr-3 text-left font-medium">Time</th>
                    <th className="py-2 pr-3 text-left font-medium">Stock</th>
                    <th className="py-2 pr-3 text-left font-medium">Order</th>
                    <th className="py-2 pr-3 text-right font-medium">Shares</th>
                    <th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-left font-medium">Why</th>
                    <th className="py-2 pr-3 text-right font-medium">P&L after charges</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((row) => (
                    <tr key={row.key} className="border-t border-ink-800">
                      <td className="py-2 pr-3 tabular-nums text-ink-400">{istTime(row.time)}</td>
                      <td className="py-2 pr-3 text-ink-100">{displaySymbol(row.symbol)}</td>
                      <td className="py-2 pr-3">{row.action}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.qty}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPrice(row.price, row.symbol)}</td>
                      <td className="py-2 pr-3 text-ink-400">{row.note}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${row.pnl == null ? '' : tone(row.pnl)}`}>
                        {row.pnl == null ? '—' : signedRupees(row.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold text-ink-100">Paper track record</h3>
      {record.length === 0 ? (
        <p className="mt-1 text-sm text-ink-400">Each finished trading day the paper trader was on is added here.</p>
      ) : (
        <div className="scroll-area mt-2 max-h-80">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-ink-900">
              <tr className="text-xs text-ink-400">
                <th className="py-2 pr-3 text-left font-medium">Date</th>
                <th className="py-2 pr-3 text-left font-medium">Strategy</th>
                <th className="py-2 pr-3 text-left font-medium">Stocks</th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                <th className="py-2 pr-3 text-right font-medium">Winners</th>
                <th className="py-2 pr-3 text-right font-medium">Charges</th>
                <th className="py-2 pr-3 text-right font-medium">Net after charges</th>
              </tr>
            </thead>
            <tbody>
              {[...record].reverse().map((r) => (
                <tr key={r.date} className="border-t border-ink-800">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-2 pr-3 text-ink-300">{STRATEGY_SHORT_NAMES[r.strategy]}</td>
                  <td className="max-w-48 truncate py-2 pr-3 text-ink-400">{r.symbols.map(displaySymbol).join(', ')}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.trades}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.wins}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(r.charges)}</td>
                  <td className={`py-2 pr-3 text-right font-medium tabular-nums ${tone(r.net)}`}>{signedRupees(r.net)}</td>
                </tr>
              ))}
              <tr className="border-t border-ink-700 font-medium">
                <td className="py-2 pr-3" colSpan={3}>
                  {record.length} days, {record.filter((r) => r.net > 0).length} profitable
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{record.reduce((sum, r) => sum + r.trades, 0)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{record.reduce((sum, r) => sum + r.wins, 0)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(record.reduce((sum, r) => sum + r.charges, 0))}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${tone(totalNet)}`}>{signedRupees(totalNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold text-ink-100">Before using real money</h3>
      <ul className="mt-2 space-y-1.5">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-2 text-sm">
            <span className={check.ok ? 'text-emerald-400' : 'text-ink-600'}>{check.ok ? '✓' : '○'}</span>
            <span className={check.ok ? 'text-ink-200' : 'text-ink-400'}>{check.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-500">
        SEBI found 7 in 10 individual intraday traders lost money in FY23, and 8 in 10 of those trading more than 500 times a year. Live orders
        through Zerodha are the next step, once these checks hold.
      </p>

      {!running && (windows.length > 0 || record.length > 0) && (
        <button
          type="button"
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            setState((s) => ({ ...DEFAULT_PAPER_STATE, settings: s.settings }));
            setConfirmReset(false);
          }}
          onBlur={() => setConfirmReset(false)}
          className="mt-4 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-400 hover:border-rose-500/50 hover:text-rose-300"
        >
          {confirmReset ? 'Click again to erase the track record' : 'Reset paper trader'}
        </button>
      )}
    </Card>
  );
}
