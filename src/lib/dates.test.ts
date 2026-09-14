import { describe, expect, it } from 'vitest';
import { exchangeClock, nextTradingDays, subtractMonths, toExchangeDate } from './dates.ts';

describe('dates', () => {
  it('skips weekends when listing future trading days', () => {
    // 2026-09-11 is a Friday.
    expect(nextTradingDays('2026-09-11', 3)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  it('converts timestamps to the date on the IST clock', () => {
    const lateUtcEvening = Date.parse('2026-09-10T20:00:00Z') / 1000; // 01:30 IST on the 11th
    expect(toExchangeDate(lateUtcEvening)).toBe('2026-09-11');
  });

  it('reports exchange-clock minutes', () => {
    expect(exchangeClock(new Date('2026-09-11T15:29:00+05:30'))).toEqual({ date: '2026-09-11', minutes: 929 });
  });

  it('subtracts months', () => {
    expect(subtractMonths('2026-09-14', 12)).toBe('2025-09-14');
  });
});
