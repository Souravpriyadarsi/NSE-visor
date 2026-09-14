import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice, MODEL_LABELS } from '../lib/format.ts';
import { MODEL_NAMES } from '../lib/models/ensemble.ts';
import type { Forecast } from '../types.ts';

type Props = { forecast: Forecast; lastClose: number; symbol: string };

export function ForecastCards({ forecast, lastClose, symbol }: Props) {
  const last = forecast.mid.length - 1;
  const expected = forecast.mid[last];
  const change = expected / lastClose - 1;

  const stats = [
    { label: `Expected by ${formatDate(forecast.dates[last])}`, value: formatPrice(expected, symbol) },
    { label: 'Expected change', value: formatPct(change, true), tone: change >= 0 ? 'text-emerald-400' : 'text-rose-400' },
    {
      label: 'Likely range (80% of simulations)',
      value: `${formatPrice(forecast.low[last], symbol)} – ${formatPrice(forecast.high[last], symbol)}`,
      small: true,
    },
    { label: 'Chance of ending higher', value: formatPct(forecast.probUp) },
  ];

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink-100">1-month forecast</h2>
      <p className="mt-0.5 text-xs text-ink-400">22 trading days ahead, blended from three simple models.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-ink-800/50 p-3">
            <dt className="text-xs text-ink-400">{s.label}</dt>
            <dd className={`mt-1 font-semibold tabular-nums ${s.small ? 'text-sm' : 'text-lg'} ${s.tone ?? ''}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-400">
        Blend: {MODEL_NAMES.map((m) => `${MODEL_LABELS[m]} ${formatPct(forecast.weights[m])}`).join(' · ')}
      </p>
    </section>
  );
}
