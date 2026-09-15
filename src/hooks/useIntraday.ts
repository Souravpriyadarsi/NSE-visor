import { useEffect, useState } from 'react';
import { loadIntraday, type IntradayRange, type PriceSource } from '../lib/data/loadIntraday.ts';
import { isMarketOpen, type IntradayHistory } from '../lib/intraday/bars.ts';

export type IntradayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; history: IntradayHistory; fetchedAt: number };

const LIVE_REFRESH_MS = 60_000;
const CLOSED_REFRESH_MS = 5 * 60_000;

/**
 * 5-minute bars for each stock. With `live`, reloads every minute while the market is open (every 5 minutes otherwise).
 * A failed reload keeps showing the last good prices. A null source waits (while checking whether Angel One is set up).
 */
export function useIntraday(
  symbols: string[],
  range: IntradayRange,
  live: boolean,
  source: PriceSource | null = 'yahoo',
): Record<string, IntradayState> {
  const [states, setStates] = useState<Record<string, IntradayState>>({});
  const key = symbols.join(',');

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const list = key ? key.split(',') : [];

    async function refresh() {
      for (const symbol of list) {
        const id = `${source}:${range}:${symbol}`;
        try {
          const history = await loadIntraday(symbol, range, controller.signal, source ?? 'yahoo');
          if (controller.signal.aborted) return;
          setStates((current) => ({ ...current, [id]: { status: 'ready', history, fetchedAt: Date.now() } }));
        } catch (err) {
          if (controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : String(err);
          setStates((current) => (current[id]?.status === 'ready' ? current : { ...current, [id]: { status: 'error', message } }));
        }
      }
      if (live && !controller.signal.aborted) {
        timer = window.setTimeout(refresh, isMarketOpen(new Date()) ? LIVE_REFRESH_MS : CLOSED_REFRESH_MS);
      }
    }

    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [key, range, live, source]);

  return Object.fromEntries(symbols.map((symbol) => [symbol, (source && states[`${source}:${range}:${symbol}`]) || { status: 'loading' }]));
}
