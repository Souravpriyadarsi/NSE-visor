import { useEffect, useState } from 'react';
import type { DepthTick } from '../lib/angel/stream.ts';
import { angelStreamUrl, loadAngelStatus, type AngelStatus, type DepthMessage } from '../lib/data/angelSource.ts';
import type { PriceSource } from '../lib/data/loadIntraday.ts';

/** Angel One's status (undefined while checking, null when unavailable), rechecked every `refreshMs` if given. */
export function useAngelStatus(refreshMs?: number): AngelStatus | null | undefined {
  const [status, setStatus] = useState<AngelStatus | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = (fresh: boolean) => {
      void loadAngelStatus(fresh).then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (refreshMs) timer = window.setTimeout(() => check(true), refreshMs);
      });
    };
    check(false);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshMs]);

  return status;
}

/** Angel One when it's set up and its login works, otherwise Yahoo. Null while checking, so prices don't load twice. */
export function usePriceSource(): PriceSource | null {
  const status = useAngelStatus();
  if (status === undefined) return null;
  return status?.configured && !status.loginFailed ? 'angel' : 'yahoo';
}

/** Live depth ticks from the local dev server's Angel One stream. */
export function useDepthStream(symbols: string[]): { ticks: Record<string, DepthTick>; connected: boolean } {
  const [ticks, setTicks] = useState<Record<string, DepthTick>>({});
  const [connected, setConnected] = useState(false);
  const key = symbols.join(',');

  useEffect(() => {
    const url = angelStreamUrl(key ? key.split(',') : []);
    if (!url) return;
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const { symbol, tick } = JSON.parse(event.data) as DepthMessage;
        setTicks((current) => ({ ...current, [symbol]: tick }));
      } catch {
        // Ignore anything that isn't a tick.
      }
    };
    return () => {
      source.close();
      setConnected(false);
    };
  }, [key]);

  return { ticks, connected };
}
