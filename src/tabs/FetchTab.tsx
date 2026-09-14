import { useEffect, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { PassphraseDialog } from '../components/PassphraseDialog.tsx';
import { useLocalStorageState } from '../hooks/useLocalStorageState.ts';
import type { SavedStocks } from '../hooks/useSavedStocks.ts';
import type { Watchlist } from '../hooks/useWatchlist.ts';
import { FRESH_FOR_MS } from '../lib/data/browserStore.ts';
import { forgetHistory, isBuiltIn, LIVE_SOURCE, loadHistory } from '../lib/data/loadHistory.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { checkPassphrase, fetchTrackedList, setTracked, TRACKING_API, WrongPassphraseError } from '../lib/data/tracking.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPrice } from '../lib/format.ts';
import type { HistoryFile, SymbolInfo } from '../types.ts';

type Props = { options: PickerOption[]; saved: SavedStocks; watchlist: Watchlist; onAnalyze: (symbol: string) => void };

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; symbol: string }
  | { kind: 'fetched'; history: HistoryFile }
  | { kind: 'builtIn'; symbol: string }
  | { kind: 'error'; message: string };

type PendingChange = { stock: SymbolInfo; track: boolean };

const SMALL_BUTTON =
  'rounded-md border border-ink-700 px-2.5 py-1 text-xs text-ink-200 hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-40';
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const parsePassphrase = (stored: unknown) => (typeof stored === 'string' ? stored : null);

export function FetchTab({ options, saved, watchlist, onAnalyze }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy = status.kind === 'loading';

  const [passphrase, setPassphrase] = useLocalStorageState('nse-predictor:tracking-passphrase', '', parsePassphrase);
  const [tracked, setTrackedList] = useState<SymbolInfo[] | null>(null);
  const [trackingError, setTrackingError] = useState('');
  const [trackingBusy, setTrackingBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ pending: PendingChange; error: string; checking: boolean } | null>(null);

  useEffect(() => {
    if (!TRACKING_API) return;
    fetchTrackedList()
      .then(setTrackedList)
      .catch((err: unknown) => setTrackingError(`Couldn't load the tracked list: ${messageOf(err)}`));
  }, []);

  const isTracked = (symbol: string) => tracked?.some((s) => s.symbol === symbol) ?? false;

  async function fetchStock(symbol: string) {
    setStatus({ kind: 'loading', symbol });
    try {
      const history = await loadHistory(symbol, { refresh: true });
      saved.save({ symbol, name: history.name });
      setStatus({ kind: 'fetched', history });
    } catch (err) {
      setStatus({ kind: 'error', message: messageOf(err) });
    }
  }

  function pick(symbol: string) {
    if (busy) return;
    if (isBuiltIn(symbol)) setStatus({ kind: 'builtIn', symbol });
    else void fetchStock(symbol);
  }

  function remove(symbol: string) {
    saved.remove(symbol);
    void forgetHistory(symbol);
    if (status.kind === 'fetched' && status.history.symbol === symbol) setStatus({ kind: 'idle' });
  }

  async function applyTracking(change: PendingChange, pass: string) {
    setTrackingBusy(change.stock.symbol);
    setTrackingError('');
    try {
      setTrackedList(await setTracked(change.stock, change.track, pass));
    } catch (err) {
      if (err instanceof WrongPassphraseError) {
        setPassphrase('');
        setDialog({ pending: change, error: err.message, checking: false });
      } else {
        setTrackingError(messageOf(err));
      }
    } finally {
      setTrackingBusy(null);
    }
  }

  function toggleTracking(stock: SymbolInfo) {
    const change = { stock, track: !isTracked(stock.symbol) };
    if (passphrase) void applyTracking(change, passphrase);
    else setDialog({ pending: change, error: '', checking: false });
  }

  async function unlock(pass: string) {
    if (!dialog) return;
    setDialog({ ...dialog, error: '', checking: true });
    try {
      await checkPassphrase(pass);
      setPassphrase(pass);
      setDialog(null);
      await applyTracking(dialog.pending, pass);
    } catch (err) {
      setDialog({ ...dialog, error: messageOf(err), checking: false });
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Fetch any NSE stock"
        subtitle="Download 10 years of daily prices for a stock that isn't built in. It then works like every other stock: it appears in the stock pickers, on the Dashboard and can go on your watchlist."
      >
        {LIVE_SOURCE ? (
          <StockPicker options={options} onSelect={pick} placeholder="Search by company or ticker, e.g. railway" />
        ) : (
          <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
            Live fetching isn't set up on this site yet: it needs the small Cloudflare Worker in the{' '}
            <code className="text-orange-100">worker/</code> folder (see the README). Stocks fetched earlier still work.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-500">
          All {options.length.toLocaleString('en-IN')} NSE stocks and main indices are listed, refreshed every evening. BE and BZ
          tags mark stocks in NSE's restricted trading series. A stock listed today and not in the list yet? Type its exact
          ticker and press Enter.
        </p>

        <StatusMessage status={status} watchlist={watchlist} onAnalyze={onAnalyze} />
      </Card>

      <Card
        title="Your fetched stocks"
        subtitle={`Kept in this browser; prices re-download when over ${FRESH_FOR_MS / 3_600_000} hours old. "Track daily" adds a stock to the evening update, so its predictions are saved in the Tracker.`}
      >
        {!TRACKING_API && (
          <p className="mb-3 text-xs text-ink-500">Daily tracking needs the Cloudflare Worker (see the README).</p>
        )}
        {trackingError && <p className="mb-3 text-xs text-rose-300">{trackingError}</p>}
        {saved.stocks.length === 0 ? (
          <p className="text-sm text-ink-400">Nothing fetched yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="py-2 pr-3 font-medium">Stock</th>
                  <th className="py-2 pr-3 font-medium">Company</th>
                  <th className="py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {saved.stocks.map((stock) => {
                  const starred = watchlist.symbols.includes(stock.symbol);
                  const trackedNow = isTracked(stock.symbol);
                  return (
                    <tr key={stock.symbol} className="border-t border-ink-800">
                      <td className="py-2.5 pr-3 font-medium">{displaySymbol(stock.symbol)}</td>
                      <td className="py-2.5 pr-3 text-ink-300">{stock.name}</td>
                      <td className="py-2.5">
                        <div className="flex justify-end gap-2">
                          <button type="button" className={SMALL_BUTTON} onClick={() => onAnalyze(stock.symbol)}>
                            Analyze
                          </button>
                          <button type="button" className={SMALL_BUTTON} onClick={() => watchlist.toggle(stock.symbol)} aria-pressed={starred}>
                            {starred ? '★ Watching' : '☆ Watch'}
                          </button>
                          <button
                            type="button"
                            className={`${SMALL_BUTTON} ${trackedNow ? 'border-emerald-500/50 text-emerald-300' : ''}`}
                            disabled={!TRACKING_API || tracked == null || trackingBusy === stock.symbol}
                            onClick={() => toggleTracking(stock)}
                            aria-pressed={trackedNow}
                            title={trackedNow ? 'Stop tracking daily' : 'Save this stock’s predictions every evening'}
                          >
                            {trackingBusy === stock.symbol ? 'Saving…' : trackedNow ? '✓ Tracked daily' : 'Track daily'}
                          </button>
                          <button
                            type="button"
                            className={SMALL_BUTTON}
                            disabled={busy || !LIVE_SOURCE}
                            onClick={() => void fetchStock(stock.symbol)}
                          >
                            Refresh
                          </button>
                          <button type="button" className={SMALL_BUTTON} onClick={() => remove(stock.symbol)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog && (
        <PassphraseDialog error={dialog.error} busy={dialog.checking} onSubmit={(pass) => void unlock(pass)} onCancel={() => setDialog(null)} />
      )}
    </div>
  );
}

type StatusProps = { status: Status; watchlist: Watchlist; onAnalyze: (symbol: string) => void };

function StatusMessage({ status, watchlist, onAnalyze }: StatusProps) {
  const box = 'mt-4 rounded-lg border px-4 py-3 text-sm';

  switch (status.kind) {
    case 'idle':
      return null;
    case 'loading':
      return (
        <p className={`${box} animate-pulse border-ink-700 text-ink-300`}>
          Fetching {displaySymbol(status.symbol)} from Yahoo Finance…
        </p>
      );
    case 'error':
      return <p className={`${box} border-rose-500/30 bg-rose-500/10 text-rose-200`}>{status.message}</p>;
    case 'builtIn':
      return (
        <div className={`${box} flex flex-wrap items-center justify-between gap-3 border-ink-700 text-ink-300`}>
          <span>{displaySymbol(status.symbol)} is already built in and tracked daily, no need to fetch it.</span>
          <button type="button" className={SMALL_BUTTON} onClick={() => onAnalyze(status.symbol)}>
            Analyze {displaySymbol(status.symbol)}
          </button>
        </div>
      );
    case 'fetched': {
      const { history } = status;
      const lastClose = history.rows[history.rows.length - 1][4];
      const starred = watchlist.symbols.includes(history.symbol);
      return (
        <div className={`${box} border-emerald-500/30 bg-emerald-500/10 text-emerald-100`}>
          <p>
            <strong className="font-semibold">
              Fetched {displaySymbol(history.symbol)}: {history.name}.
            </strong>{' '}
            {history.rows.length.toLocaleString('en-IN')} trading days from {formatDate(history.rows[0][0])} to{' '}
            {formatDate(history.lastDate)}, last close {formatPrice(lastClose, history.symbol)}. It's now in the stock pickers.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-accent-600 px-3 py-1 text-xs font-medium text-ink-950 hover:bg-accent-500"
              onClick={() => onAnalyze(history.symbol)}
            >
              Analyze {displaySymbol(history.symbol)}
            </button>
            <button type="button" className={SMALL_BUTTON} onClick={() => watchlist.toggle(history.symbol)} aria-pressed={starred}>
              {starred ? '★ On watchlist' : '☆ Add to watchlist'}
            </button>
          </div>
        </div>
      );
    }
  }
}
