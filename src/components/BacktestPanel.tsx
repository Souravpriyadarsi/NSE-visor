import { formatPct, MODEL_LABELS } from '../lib/format.ts';
import { MIN_BACKTEST_BARS, type BacktestResult } from '../lib/models/backtest.ts';
import { Card } from './Card.tsx';

export function BacktestPanel({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <Card
      title="Backtest: how accurate has it been?"
      subtitle="Each of the last 6 months was hidden, forecast from the data before it, then compared with what really happened."
    >
      {backtest ? <Results backtest={backtest} /> : (
        <p className="text-sm text-ink-400">Not enough history for a backtest (needs {MIN_BACKTEST_BARS} trading days).</p>
      )}
    </Card>
  );
}

function Results({ backtest }: { backtest: BacktestResult }) {
  const ensemble = backtest.scores.find((s) => s.key === 'ensemble')!;
  const baseline = backtest.scores.find((s) => s.key === 'baseline')!;
  const relative = ensemble.mape / baseline.mape - 1;
  const errors = `${formatPct(ensemble.mape)} vs ${formatPct(baseline.mape)} average error`;
  const verdict =
    relative < -0.03
      ? { tone: 'text-emerald-300', text: `The blended forecast beat simply assuming "no change" (${errors}).` }
      : relative <= 0.03
        ? { tone: 'text-ink-300', text: `The blended forecast did about as well as simply assuming "no change" (${errors}).` }
        : { tone: 'text-orange-300', text: `The blended forecast did worse than simply assuming "no change" (${errors}). Treat it with extra caution.` };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-400">
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 text-right font-medium">Avg error</th>
              <th className="py-2 pr-3 text-right font-medium">Error at 1 month</th>
              <th className="py-2 text-right font-medium">Direction right</th>
            </tr>
          </thead>
          <tbody>
            {backtest.scores.map((s) => (
              <tr key={s.key} className={`border-t border-ink-800 ${s.key === 'ensemble' ? 'font-semibold' : 'text-ink-300'}`}>
                <td className="py-2 pr-3">{MODEL_LABELS[s.key]}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatPct(s.mape)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatPct(s.finalError)}</td>
                <td className="py-2 text-right tabular-nums">{s.directionHits == null ? '—' : `${s.directionHits}/${backtest.windows}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-3 text-xs ${verdict.tone}`}>{verdict.text}</p>
      <p className="mt-1 text-xs text-ink-400">
        Actual prices stayed inside the 80% range {formatPct(backtest.bandCoverage)} of the time (ideal is about 80%).
      </p>
    </>
  );
}
