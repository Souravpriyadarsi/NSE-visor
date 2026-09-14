import { useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { TrustBadge } from '../components/TrustBadge.tsx';
import type { AsyncState } from '../hooks/useAsync.ts';
import { useStockSummaries } from '../hooks/useStockSummaries.ts';
import type { Watchlist } from '../hooks/useWatchlist.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import type { TrustGrade } from '../lib/research/forecastStudy.ts';
import type { ResearchScores } from '../lib/research/research.ts';
import type { Manifest, StockSource, SymbolInfo } from '../types.ts';

type Props = {
  manifest: AsyncState<Manifest | null>;
  scores: ResearchScores | null;
  fetched: SymbolInfo[];
  watchlist: Watchlist;
  onOpen: (symbol: string) => void;
};

type Row = SymbolInfo & {
  source: StockSource;
  lastDate: string | null;
  lastClose: number | null;
  dayChange: number | null;
  predicted: number | null;
  expectedChange: number | null;
  probUp: number | null;
  rank: number | null;
  trust: TrustGrade | null;
  note: string | null;
};

type SortKey = 'symbol' | 'lastClose' | 'dayChange' | 'predicted' | 'expectedChange' | 'probUp' | 'rank';

const COLUMNS: { key: SortKey; label: string; hint: string; numeric: boolean; wideOnly?: boolean }[] = [
  { key: 'symbol', label: 'Stock', hint: 'Sort by symbol', numeric: false },
  { key: 'lastClose', label: 'Close', hint: 'Latest closing price', numeric: true },
  { key: 'dayChange', label: 'Today', hint: 'Change on the latest trading day', numeric: true, wideOnly: true },
  { key: 'predicted', label: 'Predicted (1M)', hint: 'Predicted price 22 trading days (about a month) ahead', numeric: true },
  { key: 'expectedChange', label: 'Change (1M)', hint: 'Expected change over the next month', numeric: true },
  { key: 'probUp', label: 'Chance up', hint: "Share of simulations ending above today's close", numeric: true, wideOnly: true },
  {
    key: 'rank',
    label: 'Rank',
    hint: "Rank within the NIFTY 200 by the Model report's best-tested ranking signal (1 = best).",
    numeric: true,
  },
];

const WIDE_ONLY = 'hidden xl:table-cell';
const SOURCE_LABELS: Record<StockSource, string> = { 'built-in': 'Built-in', tracked: 'Tracked', fetched: 'Fetched' };
const FILTERS: ('all' | StockSource)[] = ['all', 'built-in', 'tracked', 'fetched'];
const ASCENDING_FIRST: SortKey[] = ['symbol', 'rank'];

const tone = (value: number | null) => (value == null ? 'text-ink-500' : value >= 0 ? 'text-emerald-400' : 'text-rose-400');
const empty = { lastDate: null, lastClose: null, dayChange: null, predicted: null, expectedChange: null, probUp: null };

export function DashboardTab({ manifest, scores, fetched, watchlist, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'symbol', descending: false });

  const entries = manifest.status === 'ready' ? (manifest.data?.symbols ?? []) : [];
  // Stocks fetched in this browser that the daily update doesn't cover are forecast here instead.
  const browserOnly = fetched.filter((s) => !entries.some((e) => e.symbol === s.symbol));
  const summaries = useStockSummaries(browserOnly.map((s) => s.symbol));

  const rows = useMemo(() => {
    const research = (symbol: string) => ({
      rank: scores?.stocks[symbol]?.rank ?? null,
      trust: scores?.stocks[symbol]?.trust.grade ?? null,
    });
    const all: Row[] = [
      ...entries.map((e) => ({ ...e, ...research(e.symbol), note: null })),
      ...browserOnly.map((stock, i): Row => {
        const s = summaries[i];
        if (s?.status === 'ready') return { ...stock, ...s.summary, ...research(stock.symbol), source: 'fetched', note: null };
        return { ...stock, ...empty, ...research(stock.symbol), source: 'fetched', note: s?.status === 'error' ? s.message : 'Loading…' };
      }),
    ];
    const text = query.trim().toLowerCase();
    const visible = all.filter(
      (r) =>
        (filter === 'all' || r.source === filter) &&
        (!text || displaySymbol(r.symbol).toLowerCase().includes(text) || r.name.toLowerCase().includes(text)),
    );
    const direction = sort.descending ? -1 : 1;
    return visible.sort((a, b) => {
      if (sort.key === 'symbol') return direction * displaySymbol(a.symbol).localeCompare(displaySymbol(b.symbol));
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return direction * (x - y);
    });
  }, [entries, browserOnly, summaries, scores, query, filter, sort]);

  const forecasts = rows.filter((r) => r.expectedChange != null);
  const rising = forecasts.filter((r) => r.expectedChange! >= 0).length;
  const asOf = entries.reduce((latest, e) => (e.lastDate > latest ? e.lastDate : latest), '');

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, descending: !s.descending } : { key, descending: !ASCENDING_FIRST.includes(key) }));
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stocks" value={String(rows.length)} />
        <Stat label="Prices as of" value={asOf ? formatDate(asOf) : '—'} />
        <Stat label="Forecast to rise" value={String(rising)} tone="text-emerald-400" />
        <Stat label="Forecast to fall" value={String(forecasts.length - rising)} tone="text-rose-400" />
      </div>

      {scores && <MarketStrip scores={scores} />}

      {manifest.status === 'ready' && !manifest.data && (
        <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
          The daily data hasn't been generated yet. Run <code>npm run fetch-data</code> locally (the GitHub Action does this when hosted).
        </p>
      )}

      <Card
        title="Today's sheet"
        subtitle={`Saved automatically every weekday evening, so the Tracker can compare it with what really happens.${scores ? ` Rank uses ${scores.rankSignal.label.toLowerCase()}; Rank and Trust come from the Model report's backtest.` : ''}`}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-ink-700 p-0.5" role="group" aria-label="Filter by source">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-md px-3 py-1 text-xs ${filter === f ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}
              >
                {f === 'all' ? 'All' : SOURCE_LABELS[f]}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or symbol"
            aria-label="Filter stocks"
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm placeholder:text-ink-500 focus:border-accent-500 focus:outline-none sm:w-64"
          />
        </div>

        {manifest.status === 'loading' ? (
          <div className="h-64 animate-pulse rounded-lg bg-ink-800/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-400">No stocks match.</p>
        ) : (
          <div className="scroll-area max-h-[70vh]">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 z-10 bg-ink-900">
                <tr className="text-xs text-ink-400">
                  <th className="w-8 py-2" aria-label="Watchlist" />
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`py-2 pr-3 font-medium whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'} ${c.wideOnly ? WIDE_ONLY : ''}`}
                      aria-sort={sort.key === c.key ? (sort.descending ? 'descending' : 'ascending') : undefined}
                    >
                      <button type="button" onClick={() => toggleSort(c.key)} title={c.hint} className="hover:text-ink-200">
                        {c.label}
                        {sort.key === c.key && <span className="ml-1">{sort.descending ? '↓' : '↑'}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="py-2 pr-3 text-left font-medium" title="How well the forecast has done for this stock in the backtest">
                    Trust
                  </th>
                  <th className={`py-2 pr-2 text-right font-medium ${WIDE_ONLY}`}>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const starred = watchlist.symbols.includes(r.symbol);
                  const cell = 'py-2.5 pr-3 text-right tabular-nums';
                  return (
                    <tr key={r.symbol} onClick={() => onOpen(r.symbol)} className="cursor-pointer border-t border-ink-800 hover:bg-ink-800/40">
                      <td className="py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            watchlist.toggle(r.symbol);
                          }}
                          aria-pressed={starred}
                          aria-label={starred ? `Remove ${displaySymbol(r.symbol)} from watchlist` : `Add ${displaySymbol(r.symbol)} to watchlist`}
                          className={starred ? 'text-accent-400' : 'text-ink-600 hover:text-ink-300'}
                        >
                          {starred ? '★' : '☆'}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3">
                        <button type="button" className="rounded text-left focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none">
                          <span className="block font-medium text-ink-100">{displaySymbol(r.symbol)}</span>
                          <span className="block max-w-44 truncate text-xs text-ink-400">{r.note ?? r.name}</span>
                        </button>
                      </td>
                      <td className={cell}>{r.lastClose == null ? '—' : formatPrice(r.lastClose, r.symbol)}</td>
                      <td className={`${cell} ${tone(r.dayChange)} ${WIDE_ONLY}`}>{r.dayChange == null ? '—' : formatPct(r.dayChange, true)}</td>
                      <td className={`${cell} font-semibold`}>{r.predicted == null ? '—' : formatPrice(r.predicted, r.symbol)}</td>
                      <td className={`${cell} ${tone(r.expectedChange)}`}>{r.expectedChange == null ? '—' : formatPct(r.expectedChange, true)}</td>
                      <td className={`${cell} ${WIDE_ONLY}`}>{r.probUp == null ? '—' : formatPct(r.probUp)}</td>
                      <td className={cell} title={r.rank == null ? undefined : `of ${scores?.stocks[r.symbol]?.of}`}>
                        {r.rank ?? '—'}
                      </td>
                      <td className="py-2.5 pr-3">{r.trust ? <TrustBadge grade={r.trust} /> : <span className="text-ink-600">—</span>}</td>
                      <td className={`py-2.5 pr-2 text-right ${WIDE_ONLY}`}>
                        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-400 uppercase">{SOURCE_LABELS[r.source]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function MarketStrip({ scores }: { scores: ResearchScores }) {
  const { regime } = scores;
  const history = regime.bull == null ? null : regime.rankedExcess[regime.bull ? 'bull' : 'bear'];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3 text-sm text-ink-300">
      <span className="text-xs font-medium tracking-wide text-ink-500 uppercase">Market</span>
      {regime.niftySma200 != null && (
        <span>
          NIFTY 50 <strong className={regime.bull ? 'text-emerald-400' : 'text-rose-400'}>{regime.bull ? 'above' : 'below'}</strong> its 200-day
          average ({formatPrice(regime.niftyClose, '^NSEI')} vs {formatPrice(regime.niftySma200, '^NSEI')})
        </span>
      )}
      {regime.vix != null && (
        <span>
          India VIX <strong className="text-ink-100">{regime.vix.toFixed(1)}</strong>
          {regime.vixMedian != null && (
            <span className="text-ink-400">
              {' '}
              ({regime.vixHigh ? 'more turbulent' : 'calmer'} than its usual {regime.vixMedian.toFixed(1)})
            </span>
          )}
        </span>
      )}
      {history?.excess != null && (
        <span className="text-ink-400">
          In this condition, top-ranked stocks have done{' '}
          {Math.abs(history.excess) < 0.0005 ? (
            'about the same as'
          ) : (
            <>
              <strong className={history.excess > 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatPct(Math.abs(history.excess))}</strong> a month{' '}
              {history.excess > 0 ? 'better than' : 'worse than'}
            </>
          )}{' '}
          the average stock ({history.months} months)
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, tone: color = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
