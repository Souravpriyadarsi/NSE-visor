import { formatDate } from '../lib/dates.ts';
import { formatPct } from '../lib/format.ts';
import type { ResearchScores } from '../lib/research/research.ts';
import { SIGNALS, type SignalKey } from '../lib/research/signals.ts';
import { Card } from './Card.tsx';
import { SignalStatusBadge } from './SignalStatusBadge.tsx';
import { TrustBadge } from './TrustBadge.tsx';

type Props = { symbol: string; scores: ResearchScores | null };

const pct = (value: number | null) => (value == null ? '—' : formatPct(value));

function describeValue(key: SignalKey, value: number): string {
  if (key === 'lowVolatility') return `${formatPct(-value * Math.sqrt(252))} a year`;
  if (key === 'reversal1m') return `${formatPct(-value, true)} last month`;
  return formatPct(value, true);
}

/** The stock's backtested trust grade, today's ranking and each signal, from the research backtest. */
export function ResearchPanel({ symbol, scores }: Props) {
  const score = scores?.stocks[symbol];
  const statusOf = (key: string) => scores?.signals.find((s) => s.key === key)?.status;

  return (
    <Card
      title="Track record and ranking"
      subtitle={
        scores
          ? `From the monthly backtest over the NIFTY 200, as of ${formatDate(scores.asOf)}. The Model report has the details.`
          : 'From the monthly research backtest.'
      }
    >
      {!scores ? (
        <p className="text-sm text-ink-400">The research backtest hasn't been generated yet.</p>
      ) : !score ? (
        <p className="text-sm text-ink-400">This stock isn't in the NIFTY 200, so it has no backtested track record or ranking.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-400">Forecast trust</span>
              <TrustBadge grade={score.trust.grade} />
            </div>
            <p className="mt-1 text-sm text-ink-300">
              {score.trust.months === 0
                ? 'No backtested forecasts for this stock yet.'
                : `Over ${score.trust.months} monthly forecasts, the blended forecast's error was ${pct(score.trust.ensembleError)} against ${pct(score.trust.baselineError)} for "no change". It called the direction right ${pct(score.trust.hitRate)} of the time (the price rose in ${pct(score.trust.upRate)} of months), and the range held ${pct(score.trust.coverage)} of outcomes.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-400">Ranking</span>
            {score.rank == null ? (
              <span className="text-ink-300">Not ranked (needs a year of prices).</span>
            ) : (
              <span className="text-ink-100">
                <strong>#{score.rank}</strong> of {score.of} on {scores.rankSignal.label.toLowerCase()}
              </span>
            )}
            <SignalStatusBadge status={scores.rankSignal.status} />
          </div>

          {score.rank != null && (
            <div className="scroll-area">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-xs text-ink-400">
                    <th className="py-2 pr-3 text-left font-medium">Signal</th>
                    <th className="py-2 pr-3 text-right font-medium">This stock</th>
                    <th className="py-2 pr-3 text-right font-medium">Better than</th>
                    <th className="py-2 text-right font-medium">Backtest</th>
                  </tr>
                </thead>
                <tbody>
                  {SIGNALS.map((signal) => {
                    const entry = score.signals[signal.key];
                    const status = statusOf(signal.key);
                    return (
                      <tr key={signal.key} className="border-t border-ink-800">
                        <td className="py-2 pr-3 text-ink-300" title={signal.description}>
                          {signal.label}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{entry ? describeValue(signal.key, entry.value) : '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{entry ? `${Math.round(entry.percentile * 100)}% of stocks` : '—'}</td>
                        <td className="py-2 text-right">{status && <SignalStatusBadge status={status} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
