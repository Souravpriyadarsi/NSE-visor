import type { Analysis } from '../lib/analyze.ts';
import { formatPrice } from '../lib/format.ts';
import type { Tone } from '../lib/indicators/signals.ts';
import { Card } from './Card.tsx';

const TONE_STYLES: Record<Tone, string> = {
  bullish: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  bearish: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  neutral: 'border-ink-600 bg-ink-800/60 text-ink-200',
};

export function IndicatorsPanel({ analysis, symbol }: { analysis: Analysis; symbol: string }) {
  const i = analysis.closes.length - 1;
  const { sma50, sma200, rsi, macd } = analysis.indicators;
  const show = (value: number | null, format: (v: number) => string) => (value == null ? '—' : format(value));

  const values = [
    { label: '50-day avg', value: show(sma50[i], (v) => formatPrice(v, symbol)) },
    { label: '200-day avg', value: show(sma200[i], (v) => formatPrice(v, symbol)) },
    { label: 'RSI (14)', value: show(rsi[i], (v) => v.toFixed(1)) },
    { label: 'MACD / signal', value: show(macd.macd[i], (v) => `${v.toFixed(2)} / ${macd.signal[i]?.toFixed(2) ?? '—'}`) },
  ];

  return (
    <Card title="Technical indicators" subtitle="Rules of thumb traders watch. They describe the recent past, not the future.">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {values.map((v) => (
          <div key={v.label} className="rounded-lg bg-ink-800/50 p-3">
            <dt className="text-xs text-ink-400">{v.label}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{v.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {analysis.signals.map((s) => (
          <li key={s.label} className={`rounded-lg border px-3 py-2 ${TONE_STYLES[s.tone]}`}>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-xs opacity-80">{s.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
