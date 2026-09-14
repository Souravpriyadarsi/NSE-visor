import type { ReactNode } from 'react';
import type { Tab } from '../lib/urlState.ts';

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
    {path}
  </svg>
);

const ITEMS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'dashboard', label: 'Dashboard', icon: icon(<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>) },
  { tab: 'analyze', label: 'Analyze', icon: icon(<polyline points="2,15 7,9 11,12 18,4" />) },
  { tab: 'watchlist', label: 'Watchlist', icon: icon(<path d="m10 2.5 2.3 4.7 5.2.8-3.8 3.6.9 5.2L10 14.4l-4.6 2.4.9-5.2L2.5 8l5.2-.8z" />) },
  { tab: 'tracker', label: 'Tracker', icon: icon(<><polyline points="2,14 7,9 11,11 18,5" /><polyline points="2,16 7,12 11,14 18,9" strokeDasharray="2 2" /></>) },
  { tab: 'report', label: 'Model report', icon: icon(<><path d="M4 17V10" /><path d="M10 17V4" /><path d="M16 17v-6" /><path d="M2 17h16" /></>) },
  { tab: 'fetch', label: 'Fetch any stock', icon: icon(<><path d="M10 3v10" /><polyline points="6,9 10,13 14,9" /><path d="M3 16h14" /></>) },
];

type Props = { active: Tab; onChange: (tab: Tab) => void };

export function Sidebar({ active, onChange }: Props) {
  return (
    <aside className="border-b border-ink-800 bg-ink-900/80 md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:px-5 md:pt-6 md:pb-6">
        <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#2b1f00" />
          <polyline points="4,16 9,11 13,14 20,6" fill="none" stroke="#f5b301" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <p className="text-base leading-tight font-semibold tracking-tight">NSE Visor</p>
          <p className="text-[11px] leading-tight text-ink-400">Statistical stock forecasts</p>
        </div>
      </div>

      <nav aria-label="Pages" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3 md:pb-0">
        {ITEMS.map((item) => {
          const isActive = item.tab === active;
          return (
            <button
              key={item.tab}
              type="button"
              onClick={() => onChange(item.tab)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
                isActive ? 'bg-accent-500/15 font-medium text-white' : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
              }`}
            >
              <span className={isActive ? 'text-accent-400' : ''}>{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
