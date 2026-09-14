import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Card } from '../components/Card.tsx';
import { StockChart } from '../components/StockChart.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useHistories } from '../hooks/useHistories.ts';
import { useHistory } from '../hooks/useHistory.ts';
import { loadLongHistory, loadPriceSummary } from '../lib/data/loadStatic.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate, formatMonth, subtractMonths } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import {
  needsLongHistory,
  PRICE_RANGES,
  priceSeries,
  rangeStart,
  startsLate,
  summarizePrices,
  type PriceSummary,
  type RangeKey,
} from '../lib/prices.ts';
import type { SymbolInfo } from '../types.ts';

type Props = { symbol: string; options: PickerOption[]; fetched: SymbolInfo[]; onSelectSymbol: (symbol: string) => void };

/** Trading days shown on the 1D chart, since only end-of-day prices are stored. */
const ONE_DAY_CHART_SESSIONS = 5;

const signedPrice = (value: number, symbol: string) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatPrice(Math.abs(value), symbol)}`;
/** Long-run gains can run into thousands of percent: "+17,079%" rather than "+17079.0%". */
const pctText = (fraction: number) =>
  Math.abs(fraction) >= 10 ? `${fraction > 0 ? '+' : '-'}${Math.round(Math.abs(fraction) * 100).toLocaleString('en-IN')}%` : formatPct(fraction, true);
const tone = (value: number | null) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
const rangeOf = (key: RangeKey) => PRICE_RANGES.find((r) => r.key === key)!;
/** The All time frame starts at a monthly price for older stocks, so show just the month. */
const startDateText = (range: RangeKey, date: string) => (range === 'all' ? formatMonth(date) : formatDate(date));

export function PricesTab({ symbol, options, fetched, onSelectSymbol }: Props) {
  const [range, setRange] = useState<RangeKey>('1Y');
  const rangeToggle = (
    <Toggle label="Time frame" value={range} choices={PRICE_RANGES.map((r) => ({ value: r.key, label: r.label }))} onChange={setRange} />
  );

  return (
    <div className="space-y-6">
      <StockPrice symbol={symbol} options={options} range={range} rangeToggle={rangeToggle} onSelectSymbol={onSelectSymbol} />
      <AllPrices
        range={range}
        rangeToggle={rangeToggle}
        fetched={fetched}
        selected={symbol}
        onSelect={(next) => {
          onSelectSymbol(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}

type StockPriceProps = {
  symbol: string;
  options: PickerOption[];
  range: RangeKey;
  rangeToggle: ReactNode;
  onSelectSymbol: (symbol: string) => void;
};

function StockPrice({ symbol, options, range, rangeToggle, onSelectSymbol }: StockPriceProps) {
  const { state, retry } = useHistory(symbol);
  const long = useAsync((signal) => loadLongHistory(symbol, signal).catch(() => null), [symbol]);
  const [hover, setHover] = useState<number | null>(null);
  const format = useCallback((value: number) => formatPrice(value, symbol), [symbol]);

  const history = state.status === 'ready' ? state.history : null;
  const series = useMemo(
    () => (history && long.status !== 'loading' ? priceSeries(history, long.status === 'ready' ? long.data : null) : null),
    [history, long],
  );
  const start = useMemo(() => (series ? rangeStart(series, range) : null), [series, range]);
  const view = useMemo(() => {
    if (!series || !start) return null;
    const from = range === '1D' ? Math.max(0, series.dates.length - 1 - ONE_DAY_CHART_SESSIONS) : start.index;
    return { from, dates: series.dates.slice(from), values: series.closes.slice(from) };
  }, [series, start, range]);

  let body: ReactNode;
  if (state.status === 'error') {
    body = (
      <div className="mt-5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        <p>{state.message}</p>
        {!state.unavailable && (
          <button type="button" onClick={retry} className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs hover:bg-rose-500/20">
            Try again
          </button>
        )}
      </div>
    );
  } else if (!history || !series || !start || !view) {
    body = <div className="mt-5 h-[520px] animate-pulse rounded-lg bg-ink-800/40" />;
  } else {
    const last = series.closes.length - 1;
    const hovering = hover != null && hover >= 0 && hover < view.values.length;
    const index = hovering ? view.from + hover : last;
    const price = series.closes[index];
    const change = price - start.price;
    const shownDate = series.dates[index];
    const dateText =
      index < series.monthlyPoints
        ? `Month-end close, ${formatMonth(shownDate)}`
        : `${hovering ? 'Close on' : 'Latest close,'} ${formatDate(shownDate)}`;
    const since = start.partial || hovering || range === 'all' ? `since ${startDateText(range, start.date)}` : rangeOf(range).phrase;

    const rows = history.rows;
    const [, open, high, low, close, , volume] = rows[rows.length - 1];
    const yearRows = rows.filter((row) => row[0] > subtractMonths(history.lastDate, 12));
    const stats: [string, string][] = [
      ['Open', format(open)],
      ['High', format(high)],
      ['Low', format(low)],
      ['Previous close', rows.length > 1 ? format(rows[rows.length - 2][4]) : '—'],
      ['Close', format(close)],
      ...(symbol.startsWith('^') ? [] : [['Volume', volume.toLocaleString('en-IN')] as [string, string]]),
      ['52-week high', format(Math.max(...yearRows.map((row) => row[2])))],
      ['52-week low', format(Math.min(...yearRows.map((row) => row[3])))],
    ];

    body = (
      <>
        <div className="mt-5">
          <p className="text-sm text-ink-400">
            <span className="font-medium text-ink-100">{displaySymbol(symbol)}</span> · {history.name}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{format(price)}</span>
            <span className={`text-base font-medium tabular-nums ${tone(change)}`}>
              {signedPrice(change, symbol)} ({pctText(price / start.price - 1)})
            </span>
            <span className="text-sm text-ink-400">{since}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">{dateText}</p>
        </div>

        <div className="mt-4">
          <StockChart dates={view.dates} values={view.values} base={start.price} format={format} onHover={setHover} />
        </div>

        <p className="mt-5 text-xs font-medium tracking-wide text-ink-500 uppercase">Latest trading day · {formatDate(history.lastDate)}</p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 text-sm min-[420px]:grid-cols-2 lg:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-ink-800 py-2">
              <dt className="text-ink-400">{label}</dt>
              <dd className="text-ink-100 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          {range === '1D' && (
            <li>Prices are end-of-day, so 1D compares the latest close with the one before. The chart shows the last {ONE_DAY_CHART_SESSIONS} trading days.</li>
          )}
          {start.partial && (
            <li className="text-orange-300">
              Prices for {displaySymbol(symbol)} start on {formatDate(start.date)}, so this is the change since its first traded price there.
            </li>
          )}
          {range === 'all' && series.monthlyPoints > 0 && (
            <li>
              Before {formatMonth(rows[0][0])} the chart uses month-end closing prices. The first price on record is from {formatMonth(start.date)}; for
              companies listed before Yahoo Finance's records begin, that's later than their IPO.
            </li>
          )}
          {range === 'all' && series.monthlyPoints === 0 && needsLongHistory(history) && (
            <li>Only the last 10 years of prices are available here for this stock.</li>
          )}
          <li>Prices are adjusted for splits and bonus issues, so older prices can look lower than they were quoted at the time.</li>
        </ul>
      </>
    );
  }

  return (
    <Card title="Price history" subtitle="Pick any NSE stock and a time frame. Hover over the chart to see the price on any day.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StockPicker options={options} onSelect={onSelectSymbol} placeholder="Search any NSE stock" />
        {rangeToggle}
      </div>
      {body}
    </Card>
  );
}

type TableRow = SymbolInfo & {
  start: [date: string, price: number] | null;
  /** Price history starts later than the time frame. */
  late: boolean;
  lastDate: string | null;
  lastClose: number | null;
  change: number | null;
  pct: number | null;
  note: string | null;
};
type SortColumn = 'symbol' | 'start' | 'lastClose' | 'change' | 'pct';

type AllPricesProps = {
  range: RangeKey;
  rangeToggle: ReactNode;
  fetched: SymbolInfo[];
  selected: string;
  onSelect: (symbol: string) => void;
};

function AllPrices({ range, rangeToggle, fetched, selected, onSelect }: AllPricesProps) {
  const summary = useAsync((signal) => loadPriceSummary(signal), []);
  const [sort, setSort] = useState<{ column: SortColumn; descending: boolean }>({ column: 'pct', descending: true });
  const [filter, setFilter] = useState('');

  const listed = summary.status === 'ready' ? (summary.data?.stocks ?? []) : [];
  // Stocks fetched in this browser aren't in the daily file, so they're worked out here from their price history.
  const browserOnly = summary.status === 'loading' ? [] : fetched.filter((s) => !listed.some((l) => l.symbol === s.symbol));
  const histories = useHistories(browserOnly.map((s) => s.symbol));

  const toRow = (s: PriceSummary['stocks'][number]): TableRow => {
    const start = s.starts[range];
    return {
      symbol: s.symbol,
      name: s.name,
      start,
      late: startsLate(range, start[0], s.lastDate),
      lastDate: s.lastDate,
      lastClose: s.lastClose,
      change: s.lastClose - start[1],
      pct: s.lastClose / start[1] - 1,
      note: null,
    };
  };

  const all: TableRow[] = listed.map(toRow);
  for (const stock of browserOnly) {
    const loaded = histories[stock.symbol];
    if (loaded?.status === 'ready') all.push({ ...toRow(summarizePrices(loaded.history, null)), name: stock.name });
    else {
      const note = loaded?.status === 'error' ? loaded.message : 'Loading…';
      all.push({ ...stock, start: null, late: false, lastDate: null, lastClose: null, change: null, pct: null, note });
    }
  }

  const latestDate = all.reduce((latest, r) => (r.lastDate && r.lastDate > latest ? r.lastDate : latest), '');
  const query = filter.trim().toLowerCase();
  const direction = sort.descending ? -1 : 1;
  const rows = all
    .filter((r) => !query || displaySymbol(r.symbol).toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sort.column === 'symbol') return direction * displaySymbol(a.symbol).localeCompare(displaySymbol(b.symbol));
      const x = sort.column === 'start' ? (a.start?.[1] ?? null) : a[sort.column];
      const y = sort.column === 'start' ? (b.start?.[1] ?? null) : b[sort.column];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return direction * (x - y);
    });

  const changes = all.map((r) => r.pct).filter((p): p is number => p != null).sort((a, b) => a - b);
  const rose = changes.filter((p) => p > 0).length;
  const fell = changes.filter((p) => p < 0).length;
  const median = changes.length ? changes[Math.floor(changes.length / 2)] : null;
  const startLabel = range === 'all' ? 'First price' : range === '1D' ? 'Previous close' : `Price ${rangeOf(range).label} ago`;

  const header = (column: SortColumn, label: string, numeric = true, hint?: string) => (
    <th
      className={`py-2 pr-3 font-medium whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}
      aria-sort={sort.column === column ? (sort.descending ? 'descending' : 'ascending') : undefined}
    >
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
      subtitle={`Each stock's price at the start of the time frame and at the latest close, and how much it has risen or fallen. ${
        range === 'all' ? "First price is the earliest price on record, adjusted for splits and bonuses; for older companies it's later than their IPO. " : ''
      }Click a stock to chart it.`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {rangeToggle}
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or symbol"
          aria-label="Filter stocks"
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none sm:w-56"
        />
      </div>

      {changes.length > 0 && (
        <p className="mt-3 text-sm text-ink-300">
          <span className="text-emerald-400">{rose} rose</span> and <span className="text-rose-400">{fell} fell</span> {rangeOf(range).phrase}
          {median != null && (
            <>
              . Median change <span className={tone(median)}>{pctText(median)}</span>
            </>
          )}
          .
        </p>
      )}

      {summary.status !== 'loading' && !(summary.status === 'ready' && summary.data) && (
        <p className="mt-3 text-xs text-ink-500">
          The built-in stocks come from the daily update. Running locally? Run <code>npm run fetch-data</code>.
        </p>
      )}

      {summary.status === 'loading' ? (
        <div className="mt-4 h-64 animate-pulse rounded-lg bg-ink-800/40" />
      ) : all.length === 0 ? null : rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-400">No stocks match.</p>
      ) : (
        <div className="scroll-area mt-4 max-h-[70vh]">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900">
              <tr className="text-xs text-ink-400">
                {header('symbol', 'Stock', false)}
                {header('start', startLabel, true, 'Closing price at the start of the time frame')}
                {header('lastClose', 'Current price', true, 'Latest closing price')}
                {header('change', 'Change')}
                {header('pct', 'Change %')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => onSelect(r.symbol)}
                  className={`cursor-pointer border-t border-ink-800 hover:bg-ink-800/40 ${r.symbol === selected ? 'bg-accent-500/10' : ''}`}
                >
                  <td className="py-2 pr-3">
                    <button type="button" className="rounded text-left focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none">
                      <span className="block font-medium text-ink-100">{displaySymbol(r.symbol)}</span>
                      <span className="block max-w-52 truncate text-xs text-ink-400">{r.note ?? r.name}</span>
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.start ? (
                      <>
                        <span className="block">{formatPrice(r.start[1], r.symbol)}</span>
                        <span
                          className={`block text-[11px] ${r.late ? 'text-orange-300' : 'text-ink-500'}`}
                          title={r.late ? 'Price history starts later than this time frame' : undefined}
                        >
                          {r.late ? 'since ' : ''}
                          {startDateText(range, r.start[0])}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.lastClose == null ? (
                      '—'
                    ) : (
                      <>
                        <span className="block font-medium text-ink-100">{formatPrice(r.lastClose, r.symbol)}</span>
                        {r.lastDate && r.lastDate < latestDate && <span className="block text-[11px] text-orange-300">{formatDate(r.lastDate)}</span>}
                      </>
                    )}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(r.change)}`}>{r.change == null ? '—' : signedPrice(r.change, r.symbol)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${tone(r.pct)}`}>{r.pct == null ? '—' : pctText(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
