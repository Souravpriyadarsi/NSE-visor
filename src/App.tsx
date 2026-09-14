import { useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import type { PickerOption } from './components/StockPicker.tsx';
import { useAsync } from './hooks/useAsync.ts';
import { useSavedStocks } from './hooks/useSavedStocks.ts';
import { useUrlState } from './hooks/useUrlState.ts';
import { useWatchlist } from './hooks/useWatchlist.ts';
import { BUILT_IN_STOCKS } from './lib/data/loadHistory.ts';
import { loadManifest } from './lib/data/loadStatic.ts';
import type { Tab } from './lib/urlState.ts';
import { AnalyzeTab } from './tabs/AnalyzeTab.tsx';
import { DashboardTab } from './tabs/DashboardTab.tsx';
import { FetchTab } from './tabs/FetchTab.tsx';
import { TrackerTab } from './tabs/TrackerTab.tsx';
import { WatchlistTab } from './tabs/WatchlistTab.tsx';

const PAGES: Record<Tab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: "Today's sheet: every stock's latest close and where the model puts it in a month." },
  analyze: { title: 'Analyze', subtitle: 'Forecast, backtest and technical indicators for one stock.' },
  watchlist: { title: 'Watchlist', subtitle: 'Your starred stocks at a glance.' },
  tracker: { title: 'Tracker', subtitle: 'Saved daily predictions compared with what actually happened.' },
  fetch: { title: 'Fetch any stock', subtitle: "Add NSE stocks that aren't built in, and choose which ones to track daily." },
};

export default function App() {
  const [{ tab, symbol }, navigate] = useUrlState();
  const watchlist = useWatchlist();
  const saved = useSavedStocks();
  const manifest = useAsync((signal) => loadManifest(signal), []);

  // Stock picker options: built-in, then tracked daily, then fetched in this browser.
  const options = useMemo(() => {
    const list: PickerOption[] = [...BUILT_IN_STOCKS];
    const add = (stock: PickerOption) => !list.some((s) => s.symbol === stock.symbol) && list.push(stock);
    if (manifest.status === 'ready') {
      manifest.data?.symbols.filter((e) => e.source === 'tracked').forEach((e) => add({ symbol: e.symbol, name: e.name, badge: 'Tracked' }));
    }
    saved.stocks.forEach((s) => add({ ...s, badge: 'Fetched' }));
    return list;
  }, [manifest, saved.stocks]);

  const analyzeStock = useCallback((next: string) => navigate({ tab: 'analyze', symbol: next }), [navigate]);
  const page = PAGES[tab];

  return (
    <div className="min-h-screen md:pl-60">
      <Sidebar active={tab} onChange={(next) => navigate({ tab: next })} />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{page.title}</h1>
          <p className="mt-0.5 text-sm text-ink-400">{page.subtitle}</p>
        </div>

        {tab === 'dashboard' && (
          <DashboardTab manifest={manifest} fetched={saved.stocks} watchlist={watchlist} onOpen={analyzeStock} />
        )}
        {tab === 'analyze' && <AnalyzeTab symbol={symbol} options={options} watchlist={watchlist} onSelect={analyzeStock} />}
        {tab === 'watchlist' && <WatchlistTab symbols={watchlist.symbols} onOpen={analyzeStock} onRemove={watchlist.toggle} />}
        {tab === 'tracker' && <TrackerTab symbol={symbol} onSelectSymbol={(next) => navigate({ symbol: next })} onAnalyze={analyzeStock} />}
        {tab === 'fetch' && <FetchTab saved={saved} watchlist={watchlist} onAnalyze={analyzeStock} />}
      </main>
    </div>
  );
}
