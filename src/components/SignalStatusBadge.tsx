import type { SignalStatus } from '../lib/research/rankingStudy.ts';

const STYLES: Record<SignalStatus, { label: string; className: string; hint: string }> = {
  confirmed: {
    label: 'Confirmed',
    className: 'bg-emerald-500/15 text-emerald-300',
    hint: 'Passed the development years and held up in the sealed test period.',
  },
  failedHoldout: {
    label: 'Failed sealed test',
    className: 'bg-orange-500/15 text-orange-300',
    hint: 'Passed the development years but did not hold up in the sealed test period.',
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-500/15 text-rose-300',
    hint: 'Did not pass the development years.',
  },
};

export function SignalStatusBadge({ status }: { status: SignalStatus }) {
  const style = STYLES[status];
  return (
    <span title={style.hint} className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase ${style.className}`}>
      {style.label}
    </span>
  );
}
