import { describe, expect, it } from 'vitest';
import { buildSearch, DEFAULT_SYMBOL, parseUrlState } from './urlState.ts';

describe('urlState', () => {
  it('opens the Dashboard by default', () => {
    expect(parseUrlState('')).toEqual({ tab: 'dashboard', symbol: DEFAULT_SYMBOL });
    expect(parseUrlState('?tab=nonsense')).toEqual({ tab: 'dashboard', symbol: DEFAULT_SYMBOL });
  });

  it('treats old "?s=" links as the Analyze page', () => {
    expect(parseUrlState('?s=tcs')).toEqual({ tab: 'analyze', symbol: 'TCS.NS' });
    expect(parseUrlState('?s=../../etc')).toEqual({ tab: 'analyze', symbol: DEFAULT_SYMBOL });
  });

  it('reads the tab and normalizes the symbol', () => {
    expect(parseUrlState('?tab=tracker&s=infy')).toEqual({ tab: 'tracker', symbol: 'INFY.NS' });
  });

  it('round-trips every tab and symbols with special characters', () => {
    for (const tab of ['dashboard', 'analyze', 'watchlist', 'tracker', 'report', 'tests', 'fetch'] as const) {
      for (const symbol of ['^NSEI', 'M&M.NS', 'BAJAJ-AUTO.NS']) {
        expect(parseUrlState(buildSearch({ tab, symbol }))).toEqual({ tab, symbol });
      }
    }
  });
});
