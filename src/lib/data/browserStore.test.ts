import { describe, expect, it } from 'vitest';
import type { HistoryFile } from '../../types.ts';
import { FRESH_FOR_MS, isFresh } from './browserStore.ts';

const fetchedAt = (iso: string): HistoryFile => ({ symbol: 'IRFC.NS', name: 'IRFC', updatedAt: iso, lastDate: '2026-09-11', rows: [] });

describe('isFresh', () => {
  it('treats copies younger than the freshness window as fresh', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    expect(isFresh(fetchedAt('2026-09-14T11:00:00Z'), now)).toBe(true);
    expect(isFresh(fetchedAt(new Date(now - FRESH_FOR_MS - 1).toISOString()), now)).toBe(false);
  });
});
