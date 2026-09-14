import { useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { StockPicker } from '../components/StockPicker.tsx';
import { TrackerChart, type Point } from '../components/TrackerChart.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { loadTrackerIndex, loadTrackerSheet, loadTrackerStock } from '../lib/data/loadStatic.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate, nextTradingDays } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { HORIZON } from '../lib/models/ensemble.ts';
import { scorePredictions, type Score, type TrackedPrediction, type TrackerIndex, type TrackerStock } from '../lib/tracker.ts';

type Props = { symbol: string; onSelectSymbol: (symbol: string) => void; onAnalyze: (symbol: string) => void };

const errorOf = (predicted: number, actual: number) => Math.abs(predicted - actual) / actual;
const directionRight = (close: number, predicted: number, actual: number) =>
  Math.sign(predicted - close) === Math.sign(actual - close);

export function TrackerTab({ symbol, onSelectSymbol, onAnalyze }: Props) {
  const index = useAsync((signal) => loadTrackerIndex(signal), []);
  const [view, setView] = useState<'stock' | 'day'>('stock');

  if (index.status === 'loading') return <div className="h-64 animate-pulse rounded-xl bg-ink-900" />;
  if (index.status === 'error') return <p className="text-sm text-rose-300">{index.message}</p>;
  if (!index.data || index.data.dates.length === 0) return <EmptyState />;

  const data = index.data;
  const selected = data.stocks.some((s) => s.symbol === symbol) ? symbol : data.stocks[0].symbol;

  return (
    <div className="space-y-6">
      <ScoreCards score={data.score} dates={data.dates} />

      <div className="flex w-fit rounded-lg border border-ink-700 p-0.5" role="group" aria-label="Tracker view">
        {(['stock', 'day'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'}`}
          >
            {v === 'stock' ? 'By stock' : 'By day'}
          </button>
        ))}
      </div>

      {view === 'stock' ? (
        <StockView index={data} symbol={selected} onSelectSymbol={onSelectSymbol} onAnalyze={onAnalyze} />
      ) : (
        <DayView
          index={data}
          onOpenStock={(s) => {
            onSelectSymbol(s);
            setView('stock');
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card title="No saved sheets yet" subtitle="The Tracker fills in automatically.">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-300">
        <li>Every weekday evening (17:00 IST) the daily update saves that day's forecasts for every tracked stock.</li>
        <li>22 trading days later, each prediction is compared with the actual closing price.</li>
        <li>Until then, predictions show as pending, with how many days have passed.</li>
      </ol>
      <p className="mt-3 text-xs text-ink-500">
        Running locally? Try <code>npm run fetch-data</code>, <code>npm run save-snapshot</code> and <code>npm run build-tracker</code>.
      </p>
    </Card>
  );
}

function ScoreCards({ score, dates }: { score: Score; dates: string[] }) {
  const pct = (n: number) => (score.matured ? formatPct(n / score.matured) : '—');
  const firstResult = nextTradingDays(dates[0], HORIZON)[HORIZON - 1];
  const cards = [
    { label: 'Sheets saved', value: String(dates.length), hint: `Since ${formatDate(dates[0])}` },
    { label: 'Predictions checked', value: String(score.matured), hint: score.matured ? 'Reached their target date' : `First results around ${formatDate(firstResult)}` },
    { label: 'Average error', value: score.avgError == null ? '—' : formatPct(score.avgError), hint: 'Predicted vs actual price' },
    { label: 'Direction right', value: pct(score.directionHits), hint: 'Called up or down correctly' },
    { label: 'Inside 80% range', value: pct(score.insideRange), hint: 'Ideal is about 80%' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
          <p className="text-xs text-ink-400">{c.label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{c.value}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

type StockViewProps = { index: TrackerIndex; symbol: string; onSelectSymbol: (symbol: string) => void; onAnalyze: (symbol: string) => void };

function StockView({ index, symbol, onSelectSymbol, onAnalyze }: StockViewProps) {
  const stock = useAsync((signal) => loadTrackerStock(symbol, signal), [symbol]);
  const name = index.stocks.find((s) => s.symbol === symbol)?.name ?? '';

  return (
    <Card title={`${displaySymbol(symbol)} · ${name}`} subtitle="Each dot is a price predicted a month earlier. Click a row to see that prediction's full path.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StockPicker options={index.stocks} onSelect={onSelectSymbol} allowCustom={false} placeholder="Pick a tracked stock" />
        <button
          type="button"
          onClick={() => onAnalyze(symbol)}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:border-ink-500"
        >
          Open in Analyze
        </button>
      </div>
      {stock.status === 'loading' && <div className="h-[360px] animate-pulse rounded-lg bg-ink-800/40" />}
      {stock.status === 'error' && <p className="text-sm text-rose-300">{stock.message}</p>}
      {stock.status === 'ready' &&
        (stock.data ? <StockDetails key={symbol} stock={stock.data} /> : <p className="text-sm text-ink-400">No saved predictions for this stock.</p>)}
    </Card>
  );
}

/** Trading dates covered by a prediction: real ones where known, estimated weekdays beyond that. */
function futureDates(p: TrackedPrediction, dates: string[]): string[] {
  const start = dates.indexOf(p.madeOn);
  const known = start === -1 ? [] : dates.slice(start + 1, start + 1 + HORIZON);
  return [...known, ...nextTradingDays(known.at(-1) ?? p.madeOn, HORIZON - known.length)];
}

const sortedUnique = (points: Point[]) =>
  [...new Map(points.map((p) => [p.time, p])).values()].sort((a, b) => a.time.localeCompare(b.time));

function StockDetails({ stock }: { stock: TrackerStock }) {
  const [picked, setPicked] = useState(stock.predictions[stock.predictions.length - 1].madeOn);
  const chosen = stock.predictions.find((p) => p.madeOn === picked) ?? stock.predictions[stock.predictions.length - 1];

  const dates = useMemo(() => stock.actual.map((a) => a[0]), [stock]);
  const actual = useMemo(() => stock.actual.map(([time, value]) => ({ time, value })), [stock]);
  const targets = useMemo(
    () => sortedUnique(stock.predictions.map((p) => ({ time: p.actual?.date ?? futureDates(p, dates)[HORIZON - 1], value: p.predicted }))),
    [stock, dates],
  );
  const path = useMemo(
    () => sortedUnique([{ time: chosen.madeOn, value: chosen.close }, ...futureDates(chosen, dates).map((time, k) => ({ time, value: chosen.path[k] }))]),
    [chosen, dates],
  );
  const score = scorePredictions(stock.predictions.map((p) => ({ ...p, actual: p.actual?.close ?? null })));

  return (
    <>
      <TrackerChart actual={actual} targets={targets} path={path} />
      <p className="mt-4 text-xs text-ink-400">
        {score.matured
          ? `${score.matured} checked · average error ${formatPct(score.avgError!)} · direction right ${score.directionHits}/${score.matured} · inside range ${score.insideRange}/${score.matured}`
          : 'No predictions for this stock have reached their target date yet.'}
      </p>
      <div className="scroll-area mt-3 max-h-96">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="sticky top-0 bg-ink-900">
            <tr className="text-xs whitespace-nowrap text-ink-400">
              <th className="py-2 pr-3 text-left font-medium" title="Date the prediction was saved">Made on</th>
              <th className="py-2 pr-3 text-right font-medium" title="Closing price on that date">Close</th>
              <th className="py-2 pr-3 text-right font-medium" title="22 trading days later">Target</th>
              <th className="py-2 pr-3 text-right font-medium" title="Predicted price on the target date">Predicted</th>
              <th className="py-2 pr-3 text-right font-medium" title="Actual closing price on the target date">Actual</th>
              <th className="py-2 pr-3 text-right font-medium" title="Gap between predicted and actual price">Error</th>
              <th className="py-2 pr-3 text-center font-medium" title="Did it call up or down correctly?">Dir.</th>
              <th className="py-2 text-center font-medium" title="Did the actual price land inside the 80% range?">Range</th>
            </tr>
          </thead>
          <tbody>
            {[...stock.predictions].reverse().map((p) => {
              const cell = 'py-2 pr-3 text-right tabular-nums';
              const isChosen = p.madeOn === chosen.madeOn;
              return (
                <tr
                  key={p.madeOn}
                  onClick={() => setPicked(p.madeOn)}
                  aria-selected={isChosen}
                  className={`cursor-pointer border-t border-ink-800 ${isChosen ? 'bg-accent-500/10' : 'hover:bg-ink-800/40'}`}
                >
                  <td className="py-2 pr-3">{formatDate(p.madeOn)}</td>
                  <td className={cell}>{formatPrice(p.close, stock.symbol)}</td>
                  <td className={`${cell} text-ink-400`}>
                    {p.actual ? formatDate(p.actual.date) : `~${formatDate(futureDates(p, dates)[HORIZON - 1])}`}
                  </td>
                  <td className={`${cell} font-semibold`}>{formatPrice(p.predicted, stock.symbol)}</td>
                  {p.actual ? (
                    <>
                      <td className={cell}>{formatPrice(p.actual.close, stock.symbol)}</td>
                      <td className={cell}>{formatPct(errorOf(p.predicted, p.actual.close))}</td>
                      <td className="py-2 pr-3 text-center"><Verdict ok={directionRight(p.close, p.predicted, p.actual.close)} /></td>
                      <td className="py-2 text-center"><Verdict ok={p.actual.close >= p.low && p.actual.close <= p.high} /></td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-2 text-right text-xs text-ink-500">
                      Pending · day {p.elapsed} of {HORIZON}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DayView({ index, onOpenStock }: { index: TrackerIndex; onOpenStock: (symbol: string) => void }) {
  const last = index.dates.length - 1;
  const [position, setPosition] = useState(last);
  const date = index.dates[position];
  const sheet = useAsync((signal) => loadTrackerSheet(date, signal), [date]);
  const step = 'rounded-md border border-ink-700 px-2.5 py-1 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-30';

  return (
    <Card title="Saved sheets" subtitle="Everything predicted on one day, with actual prices filled in as they arrive. Click a stock to see its history.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className={step} disabled={position === 0} onClick={() => setPosition((p) => p - 1)} aria-label="Previous sheet">
          ←
        </button>
        <span className="min-w-40 text-center text-sm font-medium">{formatDate(date)}</span>
        <button type="button" className={step} disabled={position === last} onClick={() => setPosition((p) => p + 1)} aria-label="Next sheet">
          →
        </button>
        {position !== last && (
          <button type="button" className="text-xs text-accent-400 hover:text-accent-300" onClick={() => setPosition(last)}>
            Latest
          </button>
        )}
      </div>

      {sheet.status === 'loading' && <div className="h-64 animate-pulse rounded-lg bg-ink-800/40" />}
      {sheet.status === 'error' && <p className="text-sm text-rose-300">{sheet.message}</p>}
      {sheet.status === 'ready' && sheet.data && (
        <>
          <SheetSummary score={scorePredictions(sheet.data.rows)} total={sheet.data.rows.length} />
          <div className="scroll-area mt-3 max-h-[60vh]">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-xs whitespace-nowrap text-ink-400">
                  <th className="py-2 pr-3 text-left font-medium">Stock</th>
                  <th className="py-2 pr-3 text-right font-medium" title="Closing price on the sheet's date">Close</th>
                  <th className="py-2 pr-3 text-right font-medium" title="Predicted price 22 trading days later">Predicted (1M)</th>
                  <th className="py-2 pr-3 text-right font-medium" title="Actual closing price 22 trading days later">Actual (1M)</th>
                  <th className="py-2 pr-3 text-right font-medium" title="Gap between predicted and actual price">Error</th>
                  <th className="py-2 pr-3 text-center font-medium" title="Did it call up or down correctly?">Dir.</th>
                  <th className="py-2 text-center font-medium" title="Did the actual price land inside the 80% range?">Range</th>
                </tr>
              </thead>
              <tbody>
                {sheet.data.rows.map((r) => {
                  const cell = 'py-2 pr-3 text-right tabular-nums';
                  return (
                    <tr key={r.symbol} onClick={() => onOpenStock(r.symbol)} className="cursor-pointer border-t border-ink-800 hover:bg-ink-800/40">
                      <td className="py-2 pr-3">
                        <span className="block font-medium">{displaySymbol(r.symbol)}</span>
                        <span className="block max-w-44 truncate text-xs text-ink-400">{r.name}</span>
                      </td>
                      <td className={cell}>{formatPrice(r.close, r.symbol)}</td>
                      <td className={`${cell} font-semibold`}>{formatPrice(r.predicted, r.symbol)}</td>
                      {r.actual != null ? (
                        <>
                          <td className={cell}>
                            {formatPrice(r.actual, r.symbol)}
                            {r.actualDate && <span className="block text-[11px] text-ink-500">{formatDate(r.actualDate)}</span>}
                          </td>
                          <td className={cell}>{formatPct(errorOf(r.predicted, r.actual))}</td>
                          <td className="py-2 pr-3 text-center"><Verdict ok={directionRight(r.close, r.predicted, r.actual)} /></td>
                          <td className="py-2 text-center"><Verdict ok={r.actual >= r.low && r.actual <= r.high} /></td>
                        </>
                      ) : (
                        <td colSpan={4} className="py-2 text-right text-xs text-ink-500">
                          Pending · day {r.elapsed} of {HORIZON}
                          {r.latest != null && ` · now ${formatPrice(r.latest, r.symbol)}`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function SheetSummary({ score, total }: { score: Score; total: number }) {
  if (!score.matured) return <p className="text-xs text-ink-400">{total} predictions, all still pending.</p>;
  return (
    <p className="text-xs text-ink-400">
      {score.matured} of {total} checked · average error {formatPct(score.avgError!)} · direction right {score.directionHits}/{score.matured} · inside
      range {score.insideRange}/{score.matured}
    </p>
  );
}

function Verdict({ ok }: { ok: boolean }) {
  return <span className={ok ? 'text-emerald-400' : 'text-rose-400'}>{ok ? '✓' : '✗'}</span>;
}
