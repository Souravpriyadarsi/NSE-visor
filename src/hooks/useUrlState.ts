import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSearch, parseUrlState, type UrlState } from '../lib/urlState.ts';

/** Current tab and stock, kept in the URL so links can be shared and Back/Forward work. */
export function useUrlState() {
  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const current = useRef(state);

  useEffect(() => {
    window.history.replaceState(null, '', buildSearch(current.current) + window.location.hash);
    const onPopState = () => {
      current.current = parseUrlState(window.location.search);
      setState(current.current);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((change: Partial<UrlState>) => {
    const next = { ...current.current, ...change };
    const search = buildSearch(next);
    if (search !== window.location.search) window.history.pushState(null, '', search + window.location.hash);
    current.current = next;
    setState(next);
  }, []);

  return [state, navigate] as const;
}
