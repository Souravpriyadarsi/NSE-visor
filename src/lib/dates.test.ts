import { describe, expect, it } from 'vitest';
import { addMonths, calendarGrid, exchangeClock, nextTradingDays, startOfMonth, subtractMonths, toExchangeDate } from './dates.ts';

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

describe('calendar', () => {
  it('starts each month grid on a Monday and covers six weeks', () => {
    const grid = calendarGrid('2025-09-15');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2025-09-01'); // 1 September 2025 was a Monday
    expect(grid[41]).toBe('2025-10-12');
    // October 2025 starts on a Wednesday, so the grid opens with two September days.
    expect(calendarGrid('2025-10-01').slice(0, 3)).toEqual(['2025-09-29', '2025-09-30', '2025-10-01']);
  });

  it('moves between months', () => {
    expect(startOfMonth('2026-09-15')).toBe('2026-09-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
  });
});
