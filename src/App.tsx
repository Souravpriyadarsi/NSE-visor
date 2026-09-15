import { useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import type { PickerOption } from './components/StockPicker.tsx';
import { useAsync } from './hooks/useAsync.ts';
import { useSavedStocks } from './hooks/useSavedStocks.ts';
import { useUrlState } from './hooks/useUrlState.ts';
import { useWatchlist } from './hooks/useWatchlist.ts';
import { BUILT_IN_STOCKS } from './lib/data/loadHistory.ts';
import { loadManifest, loadResearchScores, loadStockList } from './lib/data/loadStatic.ts';
import { toListedStocks } from './lib/data/stockList.ts';
import { NSE_INDICES } from './lib/data/symbols.ts';
import type { Tab } from './lib/urlState.ts';
import { AnalyzeTab } from './tabs/AnalyzeTab.tsx';
import { DashboardTab } from './tabs/DashboardTab.tsx';
import { DayTradingTab } from './tabs/DayTradingTab.tsx';
import { FetchTab } from './tabs/FetchTab.tsx';
import { PricesTab } from './tabs/PricesTab.tsx';
import { ReportTab } from './tabs/ReportTab.tsx';
import { TestsTab } from './tabs/TestsTab.tsx';
import { TrackerTab } from './tabs/TrackerTab.tsx';
import { WatchlistTab } from './tabs/WatchlistTab.tsx';

const PAGES: Record<Tab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: "Today's sheet: every stock's latest close, where the model puts it in a month, and its research rank." },
  prices: { title: 'Prices', subtitle: 'Price history for any stock, and how much every stock has risen or fallen over any time frame.' },
  analyze: { title: 'Analyze', subtitle: 'Forecast, backtest, track record and technical indicators for any NSE stock.' },
  watchlist: { title: 'Watchlist', subtitle: 'Your starred stocks at a glance.' },
  tracker: { title: 'Tracker', subtitle: 'Saved daily predictions and monthly paper portfolios, compared with what actually happened.' },
  report: { title: 'Model report', subtitle: 'How the forecasts and stock rankings have actually performed, tested month by month.' },
  tests: { title: 'Tests', subtitle: 'Try simple trading rules on real price history, including trading charges.' },
  daytrading: {
    title: 'Day trading',
    subtitle: 'Backtest intraday strategies on 5-minute prices, then let one paper-trade live prices under your risk limits.',
  },
  fetch: { title: 'Fetch any stock', subtitle: 'Add NSE stocks to your Dashboard, and choose which ones to track daily.' },
};

const SERIES_BADGES: Record<string, string> = { BE: 'BE', BZ: 'BZ' };

export default function App() {
  const [{ tab, symbol }, navigate] = useUrlState();
  const watchlist = useWatchlist();
  const saved = useSavedStocks();
  const manifest = useAsync((signal) => loadManifest(signal), []);
  const stockList = useAsync((signal) => loadStockList(signal), []);
  const research = useAsync((signal) => loadResearchScores(signal), []);
  const scores = research.status === 'ready' ? research.data : null;

  // Stock search: your own stocks first (built-in, tracked, fetched), then indices, then every NSE stock.
  const options = useMemo(() => {
    const list: PickerOption[] = [];
    const seen = new Set<string>();
    const add = (stock: PickerOption) => {
      if (seen.has(stock.symbol)) return;
      seen.add(stock.symbol);
      list.push(stock);
    };
    BUILT_IN_STOCKS.forEach((s) => add({ ...s, badge: 'Built-in' }));
    if (manifest.status === 'ready') {
      manifest.data?.symbols.forEach((e) => add({ symbol: e.symbol, name: e.name, badge: e.source === 'tracked' ? 'Tracked' : 'Built-in' }));
    }
    saved.stocks.forEach((s) => add({ ...s, badge: 'Fetched' }));
    NSE_INDICES.forEach((s) => add({ symbol: s.symbol, name: 'NSE index', badge: 'Index' }));
    if (stockList.status === 'ready' && stockList.data) {
      toListedStocks(stockList.data).forEach((s) => add({ symbol: s.symbol, name: s.name, badge: SERIES_BADGES[s.series] }));
    }
    return list;
  }, [manifest, stockList, saved.stocks]);

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
          <DashboardTab manifest={manifest} scores={scores} fetched={saved.stocks} watchlist={watchlist} onOpen={analyzeStock} />
        )}
        {tab === 'prices' && (
          <PricesTab symbol={symbol} options={options} fetched={saved.stocks} onSelectSymbol={(next) => navigate({ symbol: next })} />
        )}
        {tab === 'analyze' &&<AnalyzeTab symbol={symbol} options={options} watchlist={watchlist} scores={scores} onSelect={analyzeStock} />}
        {tab === 'watchlist' && <WatchlistTab symbols={watchlist.symbols} onOpen={analyzeStock} onRemove={watchlist.toggle} />}
        {tab === 'tracker' && <TrackerTab symbol={symbol} onSelectSymbol={(next) => navigate({ symbol: next })} onAnalyze={analyzeStock} />}
        {tab === 'report' && <ReportTab />}
        {tab === 'tests' && (
          <TestsTab symbol={symbol} options={options} fetched={saved.stocks} onSelectSymbol={(next) => navigate({ symbol: next })} />
        )}
        {tab === 'daytrading' && <DayTradingTab symbol={symbol} options={options} onSelectSymbol={(next) => navigate({ symbol: next })} />}
        {tab === 'fetch' &&<FetchTab options={options} saved={saved} watchlist={watchlist} onAnalyze={analyzeStock} />}
      </main>
    </div>
  );
}
