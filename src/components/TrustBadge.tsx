import type { TrustGrade } from '../lib/research/forecastStudy.ts';

const STYLES: Record<TrustGrade, { label: string; className: string; hint: string }> = {
  high: {
    label: 'High',
    className: 'bg-emerald-500/15 text-emerald-300',
    hint: 'Backtest: beat "no change", called direction better than always guessing, and its range held 70–90% of outcomes.',
  },
  medium: {
    label: 'Medium',
    className: 'bg-ink-800 text-ink-300',
    hint: 'Backtest: neither clearly better nor clearly worse than assuming "no change".',
  },
  low: {
    label: 'Low',
    className: 'bg-rose-500/15 text-rose-300',
    hint: 'Backtest: worse than assuming "no change", or its range was far from holding 80% of outcomes.',
  },
  unrated: {
    label: 'Unrated',
    className: 'bg-ink-800 text-ink-500',
    hint: 'Not enough history for a backtested grade (needs 2 years of monthly forecasts).',
  },
};

export function TrustBadge({ grade }: { grade: TrustGrade }) {
  const style = STYLES[grade];
  return (
    <span title={style.hint} className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase ${style.className}`}>
      {style.label}
    </span>
  );
}
