import { useMemo, useRef, useState } from 'react';
import { Card } from './Card.tsx';
import { GrowthChart, type GrowthLine } from './GrowthChart.tsx';
import { usePriceSource } from '../hooks/useAngel.ts';
import { useAsync } from '../hooks/useAsync.ts';
import { useHistories, type LoadedHistory } from '../hooks/useHistories.ts';
import type { HistoryState } from '../hooks/useHistory.ts';
import { useIntraday } from '../hooks/useIntraday.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { loadMarginMaximusSummary } from '../lib/data/loadStatic.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { CHARGES } from '../lib/tests/costs.ts';
import {
  dailySessions,
  marginMaximus,
  marginMaximusIntraday,
  marginMaximusKey,
  marginMaximusTest,
  summaryRange,
  trailRule,
  type MarginMaximusResult,
  type MmRun,
  type TrailKey,
} from '../lib/tests/marginMaximus.ts';
import type { PeriodKey } from '../lib/tests/sameDay.ts';
import type { HistoryFile, SymbolInfo } from '../types.ts';

/** The settings this test shares with the same-day one, plus its own trigger and trail. */
export type MmSettings = { shares: number; withCosts: boolean; trail: TrailKey };

/** Below this price, the bid-ask spread makes rupee-sized triggers unreliable. */
const LOW_PRICE = 20;

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const signedPct = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? '—' : formatPct(value, true));
const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');

const LINES = {
  holding: { label: 'Holding the shares bought on day one', color: CHART_COLORS.price },
  best: { label: 'Minimal Margin Maximus, best case', color: CHART_COLORS.forecast },
  worst: { label: 'Minimal Margin Maximus, worst case', color: CHART_COLORS.sma50 },
};

type CardProps = { symbol: string; state: HistoryState; retry: () => void; settings: MmSettings; from: string | null };

export function MarginMaximusCard({ symbol, state, retry, settings, from }: CardProps) {
  const { shares, withCosts, trail } = settings;
  const history = state.status === 'ready' ? state.history : null;
  const result = useMemo(
    () => (history ? marginMaximusTest(history, { shares, withCosts, trail, from }) : null),
    [history, shares, withCosts, trail, from],
  );
  const lines = useMemo<GrowthLine[]>(
    () =>
      result
        ? [
            { ...LINES.holding, values: result.holding },
            { ...LINES.best, values: result.best.values },
            { ...LINES.worst, values: result.worst.values },
          ]
        : [],
    [result],
  );

  if (state.status === 'loading') return <div className="h-[460px] animate-pulse rounded-xl bg-ink-900" />;
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
        <p>{state.message}</p>
        {!state.unavailable && (
          <button type="button" onClick={retry} className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs hover:bg-rose-500/20">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!result || !history) {
    return (
      <p className="rounded-xl border border-ink-800 p-5 text-sm text-ink-400">
        Not enough trading days after {from ? formatDate(from) : 'the start'} to test.{' '}
        {history && (
          <>
            {history.name}'s prices run from {formatDate(history.rows[0][0])} to {formatDate(history.lastDate)}.
          </>
        )}
      </p>
    );
  }

  const days = result.dates.length;
  const firstClose = history.rows.find((row) => row[0] === result.dates[0])?.[4] ?? 0;
  const lowestClose = Math.min(...history.rows.filter((row) => row[0] >= result.dates[0]).map((row) => row[4]));
  const historyStartsLater = from != null && history.rows[0][0] > from;

  return (
    <>
      <Card
        title={`${displaySymbol(symbol)} · ${history.name}`}
        subtitle={`${shares} shares bought at every close from ${formatDate(result.dates[0])} to ${formatDate(result.dates[days - 1])} (${days.toLocaleString('en-IN')} trading days), selling on the ${result.rule.label} rule, ${withCosts ? 'after' : 'before'} charges. The first buy cost ${rupees(shares * firstClose)} (${shares} × ${formatPrice(firstClose, symbol)}).`}
      >
        <GrowthChart dates={result.dates} lines={lines} format={signedRupees} />
        <p className="mt-2 text-xs text-ink-500">
          Money made or lost so far: cash from sells, less charges, plus what the shares still held are worth at that day's close.
        </p>

        <StatsTable result={result} />

        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          <li>
            <strong className="text-ink-200">Best case</strong> assumes the day's high came before any pullback, so a stop only sells when the
            close is more than the trail below the high. <strong className="text-ink-200">Worst case</strong> assumes the fall came straight after
            the stop armed. The truth is somewhere between, and the 5-minute check below follows the real order of prices for the last ~60 days.
          </li>
          <li>There is no stop-loss, so a lot that never reaches its trigger is simply held and positions pile up while the price falls.</li>
          {historyStartsLater && (
            <li className="text-orange-300">
              Price history for {displaySymbol(symbol)} starts on {formatDate(history.rows[0][0])}, so the test starts there.
            </li>
          )}
          {lowestClose < LOW_PRICE && (
            <li className="text-orange-300">
              The price was as low as ₹{lowestClose.toFixed(2)} in this period. At such low prices the gap between buying and selling prices (not
              modelled here) is a large share of a ₹{result.rule.trigger} trigger, so these results are unrealistic.
            </li>
          )}
          {withCosts && (
            <li>
              Every buy and sell is a delivery trade. The ₹{CHARGES.dpChargePerSell} DP charge is counted once for each day with a sell, however
              many lots sold that day.
            </li>
          )}
          {result.skippedDays > 0 && <li>{result.skippedDays} days with price jumps over 30% (usually unadjusted splits) were skipped.</li>}
        </ul>
      </Card>

      <FiveMinuteCheck symbol={symbol} history={history} settings={settings} />
    </>
  );
}

const STATS: { label: string; hint?: string; of: (run: MmRun) => string; toneOf?: (run: MmRun) => number | null }[] = [
  { label: 'Profit or loss', of: (run) => signedRupees(run.profit), toneOf: (run) => run.profit },
  {
    label: 'Return on peak capital',
    hint: 'Profit divided by the most money ever tied up in held shares at once',
    of: (run) => signedPct(run.returnOnPeak),
    toneOf: (run) => run.returnOnPeak,
  },
  { label: 'Peak capital tied up', hint: 'The highest total cost of the shares held at one time', of: (run) => rupees(run.peakCapital) },
  { label: 'Most shares held at once', of: (run) => run.maxShares.toLocaleString('en-IN') },
  { label: 'Sells', of: (run) => run.sells.toLocaleString('en-IN') },
  { label: 'Winning sells', of: (run) => (run.sells ? `${run.wins.toLocaleString('en-IN')} (${formatPct(run.wins / run.sells)})` : '—') },
  { label: 'Average days a lot was held', of: (run) => (run.avgHoldDays == null ? '—' : run.avgHoldDays.toFixed(1)) },
  { label: 'Charges paid', of: (run) => rupees(run.charges) },
  {
    label: 'Lots still open at the end',
    hint: 'Shares never sold, and what they would make or lose at the last close',
    of: (run) => (run.openLots ? `${run.openLots} (${run.openShares.toLocaleString('en-IN')} shares, ${signedRupees(run.unrealized)})` : 'none'),
    toneOf: (run) => (run.openLots ? run.unrealized : null),
  },
];

function StatsTable({ result }: { result: MarginMaximusResult }) {
  return (
    <div className="scroll-area mt-4">
      <table className="w-full min-w-[360px] text-sm">
        <thead>
          <tr className="text-xs whitespace-nowrap text-ink-400">
            <th className="py-2 pr-3 text-left font-medium">Result</th>
            <th className="py-2 pr-3 text-right font-medium">
              <span className="flex items-center justify-end gap-2">
                <span className="inline-block w-3 border-t-2" style={{ borderColor: LINES.worst.color }} />
                Worst case
              </span>
            </th>
            <th className="py-2 text-right font-medium">
              <span className="flex items-center justify-end gap-2">
                <span className="inline-block w-3 border-t-2" style={{ borderColor: LINES.best.color }} />
                Best case
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {STATS.map((stat) => (
            <tr key={stat.label} className="border-t border-ink-800">
              <td className="py-2 pr-3 text-ink-300" title={stat.hint}>
                {stat.label}
              </td>
              <td className={`py-2 pr-3 text-right tabular-nums ${tone(stat.toneOf?.(result.worst))}`}>{stat.of(result.worst)}</td>
              <td className={`py-2 text-right tabular-nums ${tone(stat.toneOf?.(result.best))}`}>{stat.of(result.best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The same rules on 5-minute bars, beside the daily range over exactly the same days. */
function FiveMinuteCheck({ symbol, history, settings }: { symbol: string; history: HistoryFile; settings: MmSettings }) {
  const source = usePriceSource();
  const loaded = useIntraday([symbol], '60d', false, source)[symbol];
  const intradayHistory = loaded?.status === 'ready' ? loaded.history : null;
  const fiveMinute = useMemo(() => (intradayHistory ? marginMaximusIntraday(intradayHistory, settings) : null), [intradayHistory, settings]);
  const daily = useMemo(() => {
    if (!fiveMinute) return null;
    const last = fiveMinute.dates[fiveMinute.dates.length - 1];
    const { sessions, skippedDays } = dailySessions(history, fiveMinute.dates[0]);
    return marginMaximus(
      sessions.filter((session) => session.date <= last),
      settings,
      skippedDays,
    );
  }, [fiveMinute, history, settings]);

  const range = (result: MarginMaximusResult) => (
    <>
      <td className={`py-2 pr-3 text-right tabular-nums ${tone(result.worst.profit)}`}>{signedRupees(result.worst.profit)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${tone(result.best.profit)}`}>{signedRupees(result.best.profit)}</td>
      <td className="py-2 text-right tabular-nums text-ink-400">{rupees(result.best.profit - result.worst.profit)}</td>
    </>
  );

  return (
    <Card
      title="5-minute check"
      subtitle="Daily prices only say how high and how low the day went, not in which order. Running the same rules on 5-minute bars follows the price through the day, so the range is much narrower — and because it sees the real order, it can land outside the daily one."
    >
      {!loaded || loaded.status === 'loading' ? (
        <div className="h-24 animate-pulse rounded-lg bg-ink-800/40" />
      ) : loaded.status === 'error' ? (
        <p className="rounded-lg border border-ink-800 p-4 text-sm text-ink-400">{loaded.message}</p>
      ) : !fiveMinute || !daily ? (
        <p className="text-sm text-ink-400">Not enough finished 5-minute sessions for {displaySymbol(symbol)} yet.</p>
      ) : (
        <>
          <div className="scroll-area">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="text-xs whitespace-nowrap text-ink-400">
                  <th className="py-2 pr-3 text-left font-medium">Prices used</th>
                  <th className="py-2 pr-3 text-right font-medium">Worst case</th>
                  <th className="py-2 pr-3 text-right font-medium">Best case</th>
                  <th className="py-2 text-right font-medium">Range</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-ink-800">
                  <td className="py-2 pr-3 text-ink-300">Daily highs and lows</td>
                  {range(daily)}
                </tr>
                <tr className="border-t border-ink-800">
                  <td className="py-2 pr-3 text-ink-300">5-minute bars</td>
                  {range(fiveMinute)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Only the last {fiveMinute.dates.length} trading days ({formatDate(fiveMinute.dates[0])} to{' '}
            {formatDate(fiveMinute.dates[fiveMinute.dates.length - 1])}), because 5-minute prices are only kept for about 60 days — not the period
            chosen above. Both rows buy {settings.shares} shares at every close on the {trailRule(settings.trail).label} rule,{' '}
            {settings.withCosts ? 'after' : 'before'} charges.
          </p>
        </>
      )}
    </Card>
  );
}

type SummaryRow = SymbolInfo & { peak: number | null; holding: number | null; worst: number | null; best: number | null; note: string | null };
type SortColumn = 'symbol' | 'peak' | 'holding' | 'worst' | 'best';

function MoneyCell({ value, peak }: { value: number | null; peak: number | null }) {
  return (
    <td className={`py-2 pr-3 text-right tabular-nums ${tone(value)}`}>
      {value == null ? (
        '—'
      ) : (
        <>
          <span className="block font-medium">{signedRupees(value)}</span>
          {peak ? <span className="block text-[11px] opacity-80">{signedPct(value / peak)}</span> : null}
        </>
      )}
    </td>
  );
}

type AllStocksProps = {
  settings: MmSettings;
  /** The preset period, or null when a custom start date is chosen and nothing is pre-calculated. */
  period: PeriodKey | null;
  from: string | null;
  startText: string;
  fetched: SymbolInfo[];
  selected: string;
  onSelect: (symbol: string) => void;
};

export function MarginMaximusAllStocks({ settings, period, from, startText, fetched, selected, onSelect }: AllStocksProps) {
  const summary = useAsync((signal) => loadMarginMaximusSummary(signal), []);
  const [sort, setSort] = useState<{ column: SortColumn; descending: boolean }>({ column: 'worst', descending: true });
  const [calculateAll, setCalculateAll] = useState(false);
  const results = useRef(new Map<string, MarginMaximusResult | null>());
  const { shares, withCosts, trail } = settings;

  const builtIn = summary.status === 'ready' ? (summary.data?.stocks ?? []) : [];
  // Stocks fetched in this browser aren't in the daily summary; with a custom start date, nothing is pre-calculated.
  const browserOnly = fetched.filter((s) => !s.symbol.startsWith('^') && !builtIn.some((b) => b.symbol === s.symbol));
  const toLoad = [...(period == null && calculateAll ? builtIn.map((s) => s.symbol) : []), ...browserOnly.map((s) => s.symbol)];
  const histories = useHistories(toLoad);
  const loadedCount = toLoad.filter((symbol) => histories[symbol]?.status !== 'loading').length;

  const testOf = (symbol: string, history: HistoryFile) => {
    const start = from ?? null;
    const key = `${symbol}|${shares}|${withCosts}|${trail}|${start}`;
    if (!results.current.has(key)) results.current.set(key, marginMaximusTest(history, { shares, withCosts, trail, from: start }));
    return results.current.get(key)!;
  };

  const calculatedRow = (stock: SymbolInfo, loaded: LoadedHistory | undefined): SummaryRow => {
    if (loaded?.status !== 'ready') {
      const note = loaded?.status === 'error' ? loaded.message : 'Loading…';
      return { ...stock, peak: null, holding: null, worst: null, best: null, note };
    }
    const r = testOf(stock.symbol, loaded.history);
    return {
      ...stock,
      peak: r ? Math.max(r.best.peakCapital, r.worst.peakCapital) : null,
      holding: r ? r.holding[r.holding.length - 1] : null,
      worst: r?.worst.profit ?? null,
      best: r?.best.profit ?? null,
      note: r ? null : 'No prices after the start date',
    };
  };

  const list: SummaryRow[] = [];
  if (period != null) {
    const key = marginMaximusKey(shares, period, trail);
    for (const s of builtIn) {
      const row = s.results[key];
      const [worst, best] = row ? summaryRange(row, withCosts) : [null, null];
      list.push({ symbol: s.symbol, name: s.name, peak: row?.[0] ?? null, holding: row?.[1] ?? null, worst, best, note: null });
    }
  } else if (calculateAll) {
    for (const s of builtIn) list.push(calculatedRow({ symbol: s.symbol, name: s.name }, histories[s.symbol]));
  }
  for (const s of browserOnly) list.push(calculatedRow(s, histories[s.symbol]));

  const direction = sort.descending ? -1 : 1;
  const rows = list.sort((a, b) => {
    if (sort.column === 'symbol') return direction * displaySymbol(a.symbol).localeCompare(displaySymbol(b.symbol));
    const x = a[sort.column];
    const y = b[sort.column];
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return direction * (x - y);
  });

  const staleSummary = period != null && builtIn.length > 0 && builtIn.every((s) => !s.results[marginMaximusKey(shares, period, trail)]);
  const complete = rows.filter((r) => r.holding != null && r.worst != null && r.best != null);
  const worstBeatsHolding = complete.filter((r) => r.worst! > r.holding!).length;
  const bestBeatsHolding = complete.filter((r) => r.best! > r.holding!).length;

  const header = (column: SortColumn, label: string, numeric = true, hint?: string) => (
    <th className={`py-2 pr-3 font-medium whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        title={hint}
        className="hover:text-ink-200"
        onClick={() => setSort((s) => ({ column, descending: s.column === column ? !s.descending : column !== 'symbol' }))}
      >
        {label}
        {sort.column === column && <span className="ml-1">{sort.descending ? '↓' : '↑'}</span>}
      </button>
    </th>
  );

  return (
    <Card
      title="All stocks"
      subtitle={`Profit or loss buying ${shares} shares at every close ${startText} on the ${trailRule(trail).label} rule, ${withCosts ? 'after' : 'before'} charges, next to simply holding ${shares} shares from day one. Percentages are the profit against the peak capital tied up. Click a stock to chart it.`}
    >
      {staleSummary && (
        <p className="mb-3 text-xs text-orange-300">This table's data is from an older version of the site. Refresh the page to load the latest.</p>
      )}
      {period != null && summary.status === 'ready' && !summary.data && (
        <p className="mb-3 text-xs text-ink-500">
          The built-in stocks' table comes from the daily update. Running locally? Run <code>npm run margin-maximus-test</code>.
        </p>
      )}

      {period == null && !calculateAll && builtIn.length > 0 && (
        <div className="mb-4 rounded-lg border border-ink-800 bg-ink-950/40 p-4 text-sm text-ink-300">
          <p>
            The table is pre-calculated for the 1, 3 and 5-year periods and all history. For a custom start date, each of the {builtIn.length}{' '}
            stocks' price history is downloaded once and tested in your browser (about 10 seconds).
          </p>
          <button
            type="button"
            onClick={() => setCalculateAll(true)}
            className="mt-3 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-accent-500"
          >
            Calculate from {from ? formatDate(from) : 'the start'} for all stocks
          </button>
        </div>
      )}

      {toLoad.length > 0 && loadedCount < toLoad.length && (
        <p className="mb-3 text-xs text-ink-400">
          Loading price histories: {loadedCount} of {toLoad.length}…
        </p>
      )}

      {complete.length > 0 && (
        <p className="mb-3 text-sm text-ink-300">
          Beat simply holding for <strong>{worstBeatsHolding}</strong> of {complete.length} stocks even in the worst case, and{' '}
          <strong>{bestBeatsHolding}</strong> in the best case.
        </p>
      )}

      {summary.status === 'loading' ? (
        <div className="h-48 animate-pulse rounded-lg bg-ink-800/40" />
      ) : rows.length === 0 ? (
        period != null && <p className="text-sm text-ink-400">No stocks to show.</p>
      ) : (
        <div className="scroll-area max-h-[60vh]">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900">
              <tr className="text-xs text-ink-400">
                {header('symbol', 'Stock', false)}
                {header('peak', 'Peak capital', true, 'The most money tied up in held shares at once')}
                {header('holding', 'Holding', true, 'Buying the same number of shares once, on the first day')}
                {header('worst', 'MMM worst', true, 'Sorts by rupees')}
                {header('best', 'MMM best', true, 'Sorts by rupees')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => {
                    onSelect(r.symbol);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  aria-selected={r.symbol === selected}
                  className={`cursor-pointer border-t border-ink-800 ${r.symbol === selected ? 'bg-accent-500/10' : 'hover:bg-ink-800/40'}`}
                >
                  <td className="py-2 pr-3">
                    <span className="block font-medium">{displaySymbol(r.symbol)}</span>
                    <span className="block max-w-56 truncate text-xs text-ink-400">{r.note ?? r.name}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-300">{r.peak == null ? '—' : rupees(r.peak)}</td>
                  <MoneyCell value={r.holding} peak={r.peak} />
                  <MoneyCell value={r.worst} peak={r.peak} />
                  <MoneyCell value={r.best} peak={r.peak} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function MarginMaximusHow({ trail }: { trail: TrailKey }) {
  const rule = trailRule(trail);
  return (
    <Card
      title="How the test works"
      subtitle="Minimal Margin Maximus buys a little every day and lets trailing stops take the profits. Charges are a typical discount broker's (Zerodha's published rates)."
    >
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
        <li>
          Every trading day it buys the same number of shares at the close. Each buy is its own lot with its own buy price, and the day's lot is
          bought after that day's selling.
        </li>
        <li>
          <strong className="text-ink-100">The whole holding comes first.</strong> Once the price reaches the average buy price of every share
          held plus ₹{rule.trigger}, a trailing stop arms for all of them: they sell when the price falls ₹{rule.trail} below the highest price
          since it armed. Bought at an average of ₹100, up to ₹120, then falling: sold at ₹119 on the ₹2 / ₹1 rule.
        </li>
        <li>
          <strong className="text-ink-100">Otherwise each lot fends for itself.</strong> Any lot whose own buy price + ₹{rule.trigger} is reached
          arms the same trailing stop for its shares alone, so cheaper lots take their profit while the rest wait.
        </li>
        <li>Anything armed but not stopped by the close is sold at the close, so nothing is left half-open overnight.</li>
        <li>
          <strong className="text-ink-100">There is no stop-loss.</strong> A lot that never reaches its trigger is simply held, buying carries on
          every day, and positions pile up in a falling market. That is why the table shows the peak capital tied up: it is the money you need to
          have, and returns are measured against it.
        </li>
        <li>
          Lots are held overnight, so every buy and sell pays delivery charges: STT 0.1% on both sides, stamp duty 0.015% on the buy, no
          brokerage, NSE and SEBI charges with GST, and a ₹{CHARGES.dpChargePerSell} DP charge counted once per day with a sell, however many lots
          sold. "Before charges" sets all of them to zero.
        </li>
        <li>
          Daily prices don't say whether the high came before or after the low, so every result is a range. The{' '}
          <strong className="text-ink-100">best case</strong> assumes the high came first and the stop only sold if the close was more than the
          trail below it; the <strong className="text-ink-100">worst case</strong> assumes the fall came straight after the stop armed. A gap-up
          arms the stop at the open. The 5-minute check runs the same rules bar by bar over the last ~60 trading days, where the range is much
          narrower.
        </li>
        <li>
          Stops fill at exactly their price. Real ones rarely do, the gap between buying and selling prices isn't modelled, and neither are
          dividends or income tax, so real results would be worse. Holiday placeholder rows and jumps over 30% (usually unadjusted splits) are
          skipped.
        </li>
      </ul>
    </Card>
  );
}
