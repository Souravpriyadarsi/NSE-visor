import { useMemo } from 'react';
import { BacktestPanel } from '../components/BacktestPanel.tsx';
import { ForecastCards } from '../components/ForecastCards.tsx';
import { IndicatorsPanel } from '../components/IndicatorsPanel.tsx';
import { PriceChart } from '../components/PriceChart.tsx';
import { ResearchPanel } from '../components/ResearchPanel.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { useHistory } from '../hooks/useHistory.ts';
import type { Watchlist } from '../hooks/useWatchlist.ts';
import { analyze, summarize } from '../lib/analyze.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { MIN_FORECAST_BARS } from '../lib/models/ensemble.ts';
import type { ResearchScores } from '../lib/research/research.ts';
import type { HistoryFile } from '../types.ts';

type Props = {
  symbol: string;
  options: PickerOption[];
  watchlist: Watchlist;
  scores: ResearchScores | null;
  onSelect: (symbol: string) => void;
};

export function AnalyzeTab({ symbol, options, watchlist, scores, onSelect }: Props) {
  const { state, retry } = useHistory(symbol);
  const analysis = useMemo(() => (state.status === 'ready' ? analyze(state.history) : null), [state]);
  const history = state.status === 'ready' ? state.history : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-400">Search any NSE stock or index by company name or ticker.</p>
        <StockPicker options={options} onSelect={onSelect} placeholder="Search NSE stocks, e.g. Tata" />
      </div>

      {state.status === 'loading' && <LoadingState />}

      {state.status === 'error' && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
          <p>{state.message}</p>
          {!state.unavailable && (
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs hover:bg-rose-500/20"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {history && analysis && (
        <>
          <StockHeader
            history={history}
            starred={watchlist.symbols.includes(history.symbol)}
            onToggleStar={() => watchlist.toggle(history.symbol)}
          />
          <PriceChart analysis={analysis} />
          <div className="grid gap-6 lg:grid-cols-2">
            {analysis.forecast ? (
              <ForecastCards
                forecast={analysis.forecast}
                lastClose={analysis.closes[analysis.closes.length - 1]}
                symbol={history.symbol}
              />
            ) : (
              <p className="rounded-xl border border-ink-800 p-5 text-sm text-ink-400">
                Not enough history to forecast (needs {MIN_FORECAST_BARS} trading days).
              </p>
            )}
            <BacktestPanel backtest={analysis.backtest} />
          </div>
          <ResearchPanel symbol={history.symbol} scores={scores} />
          <IndicatorsPanel analysis={analysis} symbol={history.symbol} />
          <p className="text-xs text-ink-500">
            Prices updated{' '}
            {new Date(history.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST.
          </p>
        </>
      )}
    </div>
  );
}

type StockHeaderProps = { history: HistoryFile; starred: boolean; onToggleStar: () => void };

function StockHeader({ history, starred, onToggleStar }: StockHeaderProps) {
  const { lastClose, dayChange } = summarize(history);

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">{displaySymbol(history.symbol)}</h2>
          <button
            type="button"
            onClick={onToggleStar}
            aria-pressed={starred}
            title={starred ? 'Remove from watchlist' : 'Add to watchlist'}
            className={`text-xl leading-none ${starred ? 'text-accent-400' : 'text-ink-500 hover:text-ink-300'}`}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
        <p className="text-sm text-ink-400">{history.name}</p>
      </div>
      <div className="text-right">
        <p className="text-2xl font-semibold tabular-nums">{formatPrice(lastClose, history.symbol)}</p>
        <p className={`text-sm tabular-nums ${dayChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {formatPct(dayChange, true)} <span className="text-ink-500">on {formatDate(history.lastDate)}</span>
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading">
      <div className="h-14 w-72 rounded-lg bg-ink-800" />
      <div className="h-[440px] rounded-xl bg-ink-900 sm:h-[540px]" />
    </div>
  );
}
