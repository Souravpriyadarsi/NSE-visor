import { useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/** Runs `load` whenever `deps` change and tracks its loading/error/result state. */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal)
      .then((data) => !controller.signal.aborted && setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
