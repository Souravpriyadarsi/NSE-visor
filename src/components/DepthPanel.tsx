import { useMemo } from 'react';
import { Card } from './Card.tsx';
import { StockPicker, type PickerOption } from './StockPicker.tsx';
import { useAngelStatus, useDepthStream } from '../hooks/useAngel.ts';
import { useLocalStorageState } from '../hooks/useLocalStorageState.ts';
import { summarizeDepth } from '../lib/angel/depth.ts';
import type { DepthLevel, DepthTick } from '../lib/angel/stream.ts';
import type { AngelStatus } from '../lib/data/angelSource.ts';
import { displaySymbol, isValidSymbol } from '../lib/data/symbols.ts';
import { formatPct, formatPrice } from '../lib/format.ts';

const MAX_STOCKS = 5;
const STATUS_REFRESH_MS = 10_000;

const parseSymbols = (stored: unknown) =>
  Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string' && isValidSymbol(s)).slice(0, MAX_STOCKS) : null;
const quantity = (value: number) => Math.round(value).toLocaleString('en-IN');
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
const tone = (value: number) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');

/** Live best-5 market depth for a few stocks, from the local Angel One stream. */
export function DepthPanel({ options }: { options: PickerOption[] }) {
  const status = useAngelStatus(STATUS_REFRESH_MS);
  const [symbols, setSymbols] = useLocalStorageState<string[]>('nse-visor:depth-stocks', ['RELIANCE.NS'], parseSymbols);
  const ready = status?.configured === true && !status.loginFailed;
  const { ticks, connected } = useDepthStream(ready ? symbols : []);
  const pickerOptions = useMemo(() => options.filter((o) => !symbols.includes(o.symbol)), [options, symbols]);

  let body;
  if (status === undefined) {
    body = <div className="h-24 animate-pulse rounded-lg bg-ink-800/40" />;
  } else if (!ready) {
    body = <Setup status={status} />;
  } else {
    const live = connected && status.streaming;
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3">
          {symbols.length < MAX_STOCKS && (
            <StockPicker
              options={pickerOptions}
              onSelect={(symbol) => !symbols.includes(symbol) && setSymbols([...symbols, symbol])}
              placeholder={`Add up to ${MAX_STOCKS} stocks`}
            />
          )}
          <span className="flex items-center gap-2 text-xs text-ink-400">
            <span className={`inline-block h-2 w-2 rounded-full ${live ? 'bg-emerald-400' : 'bg-orange-400'}`} />
            {live ? 'Live' : 'Connecting…'}
            {status.lastTickAt != null && ` · last update ${clock(status.lastTickAt)}`}
          </span>
        </div>
        {status.error && <p className="mt-2 text-xs text-orange-300">{status.error}</p>}
        {symbols.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400">Add a stock to see its market depth.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {symbols.map((symbol) => (
              <DepthCard
                key={symbol}
                symbol={symbol}
                tick={ticks[symbol]}
                recording={status.recording.includes(symbol)}
                onRemove={() => setSymbols(symbols.filter((s) => s !== symbol))}
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-500">
          Angel One's live feed, updated a few times a second while the market is open. Market data only: nothing here places orders.
        </p>
      </>
    );
  }

  return (
    <Card
      title="Market depth (Angel One)"
      subtitle="The best 5 prices buyers are bidding and sellers are asking, and how many shares wait at each, from your free Angel One account."
    >
      {body}
    </Card>
  );
}

function Setup({ status }: { status: AngelStatus | null }) {
  if (status?.loginFailed) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        <p>{status.error}</p>
        <p className="mt-2 text-xs text-rose-200/80">
          Check the details in .env.local, then restart npm run dev. It doesn't retry on its own, because repeated wrong logins can lock an Angel
          One account.
        </p>
      </div>
    );
  }
  const link = 'text-accent-400 hover:underline';
  return (
    <div className="text-sm text-ink-300">
      <p>
        {status === null
          ? 'Market depth runs in the local app on your PC (npm run dev) for now. On this site, intraday prices come from Yahoo Finance.'
          : "Not set up yet, so intraday prices come from Yahoo Finance. Angel One's API is free, and paper trading never needs money in the account."}
      </p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-ink-400">
        <li>Open a free Angel One account. A Basic Services Demat Account with no holdings has no yearly fee.</li>
        <li>
          Sign in at{' '}
          <a href="https://smartapi.angelbroking.com" target="_blank" rel="noreferrer" className={link}>
            smartapi.angelbroking.com
          </a>
          , create an app (any redirect URL, such as http://localhost) and copy its API key.
        </li>
        <li>
          Turn on TOTP at{' '}
          <a href="https://smartapi.angelbroking.com/enable-totp" target="_blank" rel="noreferrer" className={link}>
            smartapi.angelbroking.com/enable-totp
          </a>{' '}
          and copy the secret shown under the QR code.
        </li>
        <li>
          In the project folder, copy <code className="text-ink-200">.env.example</code> to <code className="text-ink-200">.env.local</code> and fill in
          your details. That file stays on your PC and is never uploaded.
        </li>
        <li>
          Restart <code className="text-ink-200">npm run dev</code>.
        </li>
      </ol>
    </div>
  );
}

type DepthCardProps = { symbol: string; tick: DepthTick | undefined; recording: boolean; onRemove: () => void };

function DepthCard({ symbol, tick, recording, onRemove }: DepthCardProps) {
  const format = (value: number) => formatPrice(value, symbol);
  return (
    <div className="rounded-lg border border-ink-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink-100">
            {displaySymbol(symbol)}
            {recording && <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">● Recording</span>}
          </p>
          {tick ? (
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-semibold tabular-nums">{format(tick.ltp)}</span>
              {tick.close ? <span className={`text-sm tabular-nums ${tone(tick.ltp - tick.close)}`}>{formatPct(tick.ltp / tick.close - 1, true)}</span> : null}
              <span className="text-[11px] text-ink-500 tabular-nums">{clock(tick.time)}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-400">Waiting for prices…</p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Remove ${displaySymbol(symbol)}`}
          onClick={onRemove}
          className="rounded px-1.5 text-ink-500 hover:text-white"
        >
          ×
        </button>
      </div>
      {tick && tick.bids.length + tick.asks.length > 0 && (
        <>
          <Ladder tick={tick} format={format} />
          <DepthStats tick={tick} format={format} />
        </>
      )}
    </div>
  );
}

function Ladder({ tick, format }: { tick: DepthTick; format: (value: number) => string }) {
  const largest = Math.max(1, ...tick.bids.map((l) => l.quantity), ...tick.asks.map((l) => l.quantity));
  const width = (level: DepthLevel | undefined) => `${level ? (level.quantity / largest) * 100 : 0}%`;
  return (
    <div className="scroll-area mt-3">
      <table className="w-full min-w-[320px] text-xs tabular-nums">
        <thead>
          <tr className="text-ink-500">
            <th className="py-1 text-left font-medium">Orders</th>
            <th className="py-1 pr-2 text-right font-medium">Buyers want</th>
            <th className="py-1 pr-3 text-right font-medium">Bid</th>
            <th className="py-1 pl-3 text-left font-medium">Ask</th>
            <th className="py-1 pl-2 text-left font-medium">Sellers offer</th>
            <th className="py-1 text-right font-medium">Orders</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }, (_, i) => {
            const bid = tick.bids[i];
            const ask = tick.asks[i];
            return (
              <tr key={i} className="border-t border-ink-800/60">
                <td className="py-1 text-ink-500">{bid?.orders ?? ''}</td>
                <td className="relative py-1 pr-2 text-right">
                  <span className="absolute inset-y-0.5 right-0 rounded-sm bg-emerald-500/15" style={{ width: width(bid) }} />
                  <span className="relative">{bid ? quantity(bid.quantity) : ''}</span>
                </td>
                <td className="py-1 pr-3 text-right font-medium text-emerald-400">{bid ? format(bid.price) : '—'}</td>
                <td className="py-1 pl-3 text-left font-medium text-rose-400">{ask ? format(ask.price) : '—'}</td>
                <td className="relative py-1 pl-2 text-left">
                  <span className="absolute inset-y-0.5 left-0 rounded-sm bg-rose-500/15" style={{ width: width(ask) }} />
                  <span className="relative">{ask ? quantity(ask.quantity) : ''}</span>
                </td>
                <td className="py-1 text-right text-ink-500">{ask?.orders ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DepthStats({ tick, format }: { tick: DepthTick; format: (value: number) => string }) {
  const summary = summarizeDepth(tick);
  const buyShare = summary.imbalance == null ? null : (summary.imbalance + 1) / 2;
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-ink-400">
        <span>
          Spread{' '}
          <span className="text-ink-100 tabular-nums">
            {summary.spread == null || summary.spreadPct == null ? '—' : `${format(summary.spread)} (${(summary.spreadPct * 100).toFixed(3)}%)`}
          </span>
        </span>
        {tick.totalBuyQty != null && tick.totalSellQty != null && (
          <span className="tabular-nums">
            Whole book: buy {quantity(tick.totalBuyQty)} · sell {quantity(tick.totalSellQty)}
          </span>
        )}
      </div>
      {buyShare != null && (
        <div>
          <div className="flex justify-between">
            <span className="text-emerald-400">Buyers {Math.round(buyShare * 100)}%</span>
            <span className="text-ink-500">best 5 levels</span>
            <span className="text-rose-400">Sellers {Math.round((1 - buyShare) * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-rose-500/40">
            <div className="h-full bg-emerald-500/70" style={{ width: `${buyShare * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
