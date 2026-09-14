import type { ReactNode } from 'react';

type Props = { title: string; subtitle?: string; children: ReactNode };

export function Card({ title, subtitle, children }: Props) {
  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
