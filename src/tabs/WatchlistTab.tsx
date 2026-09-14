import { Card } from '../components/Card.tsx';
import { useStockSummaries, type SummaryRow } from '../hooks/useStockSummaries.ts';
import type { StockSummary } from '../lib/analyze.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';

type Props = { symbols: string[]; onOpen: (symbol: string) => void; onRemove: (symbol: string) => void };

const NUMBER_CELL = 'py-3 pr-3 text-right tabular-nums';
const toneOf = (value: number | null) => (value == null ? 'text-ink-400' : value >= 0 ? 'text-emerald-400' : 'text-rose-400');

export function WatchlistTab({ symbols, onOpen, onRemove }: Props) {
  const rows = useStockSummaries(symbols);

  return (
    <Card
      title="Starred stocks"
      subtitle="Latest price and 1-month forecast for every stock you've starred. Click a stock to open its full analysis."
    >
      {symbols.length === 0 ? (
        <p className="text-sm text-ink-400">Your watchlist is empty. Open a stock in the Analyze tab and click ☆ to add it.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="py-2 pr-3 font-medium">Stock</th>
                  <th className="py-2 pr-3 text-right font-medium">Current price</th>
                  <th className="py-2 pr-3 text-right font-medium">Today</th>
                  <th className="py-2 pr-3 text-right font-medium">Predicted in 1 month</th>
                  <th className="py-2 pr-3 text-right font-medium">Expected change</th>
                  <th className="py-2 pr-3 text-right font-medium">Chance higher</th>
                  <th className="py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.symbol} row={row} onOpen={onOpen} onRemove={onRemove} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Current price is the latest daily close. Predictions use the same blended model as the Analyze tab.
          </p>
        </>
      )}
    </Card>
  );
}

type RowProps = { row: SummaryRow; onOpen: (symbol: string) => void; onRemove: (symbol: string) => void };

function Row({ row, onOpen, onRemove }: RowProps) {
  const subtitle = row.status === 'ready' ? row.summary.name : row.status === 'error' ? 'Unavailable' : 'Loading…';

  return (
    <tr onClick={() => onOpen(row.symbol)} className="cursor-pointer border-t border-ink-800 hover:bg-ink-800/40">
      <td className="py-3 pr-3">
        {/* Clicks bubble up to the row; the button makes rows reachable by keyboard. */}
        <button type="button" className="rounded text-left focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none">
          <span className="block font-medium text-ink-100">{displaySymbol(row.symbol)}</span>
          <span className="block max-w-56 truncate text-xs text-ink-400">{subtitle}</span>
        </button>
      </td>

      {row.status === 'loading' &&
        [0, 1, 2, 3, 4].map((i) => (
          <td key={i} className={NUMBER_CELL}>
            <span className="inline-block h-3 w-16 animate-pulse rounded bg-ink-800" />
          </td>
        ))}

      {row.status === 'error' && (
        <td colSpan={5} className="py-3 pr-3 text-xs text-rose-300">
          {row.message}
        </td>
      )}

      {row.status === 'ready' && <SummaryCells summary={row.summary} />}

      <td className="py-3 text-right">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(row.symbol);
          }}
          aria-label={`Remove ${displaySymbol(row.symbol)} from watchlist`}
          className="rounded px-2 py-1 text-ink-500 hover:text-ink-200"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function SummaryCells({ summary: s }: { summary: StockSummary }) {
  return (
    <>
      <td className={NUMBER_CELL} title={`Close on ${formatDate(s.lastDate)}`}>
        {formatPrice(s.lastClose, s.symbol)}
      </td>
      <td className={`${NUMBER_CELL} ${toneOf(s.dayChange)}`}>{formatPct(s.dayChange, true)}</td>
      <td className={`${NUMBER_CELL} font-semibold`}>{s.predicted == null ? '—' : formatPrice(s.predicted, s.symbol)}</td>
      <td className={`${NUMBER_CELL} ${toneOf(s.expectedChange)}`}>
        {s.expectedChange == null ? '—' : formatPct(s.expectedChange, true)}
      </td>
      <td className={NUMBER_CELL}>{s.probUp == null ? '—' : formatPct(s.probUp)}</td>
    </>
  );
}
