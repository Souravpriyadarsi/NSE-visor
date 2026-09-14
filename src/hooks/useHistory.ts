import { useEffect, useState } from 'react';
import { loadHistory, SymbolUnavailableError } from '../lib/data/loadHistory.ts';
import type { HistoryFile } from '../types.ts';

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string; unavailable: boolean }
  | { status: 'ready'; history: HistoryFile };

export function useHistory(symbol: string) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadHistory(symbol, { signal: controller.signal })
      .then((history) => setState({ status: 'ready', history }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          unavailable: err instanceof SymbolUnavailableError,
        });
      });
    return () => controller.abort();
  }, [symbol, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
