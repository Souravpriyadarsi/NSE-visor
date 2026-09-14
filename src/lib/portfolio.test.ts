import { describe, expect, it } from 'vitest';
import type { HistoryFile, Row } from '../types.ts';
import { nextTradingDays } from './dates.ts';
import { closeOn, evaluatePortfolios, pickPortfolio, type PaperPortfolio } from './portfolio.ts';

function history(symbol: string, closes: number[]): HistoryFile {
  const dates = ['2026-01-01', ...nextTradingDays('2026-01-01', closes.length - 1)];
  const rows: Row[] = closes.map((c, i) => [dates[i], c, c, c, c, c, 1000]);
  return { symbol, name: `${symbol} Ltd`, updatedAt: '', lastDate: dates[dates.length - 1], rows };
}

const a = history('A.NS', [100, 101, 102, 103, 104, 110, 120]);
const b = history('B.NS', [50, 50, 50, 50, 50, 40, 45]);
const nifty = history('^NSEI', [1000, 1000, 1010, 1020, 1030, 1040, 1050]);
const histories = new Map([a, b, nifty].map((h) => [h.symbol, h]));
const day = (i: number) => a.rows[i][0];

describe('closeOn', () => {
  it('uses the last close on or before the date', () => {
    expect(closeOn(a.rows, '2025-12-31')).toBeNull();
    expect(closeOn(a.rows, day(2))).toBe(102);
    expect(closeOn(a.rows, '2026-01-04')).toBe(101);
  });
});

describe('evaluatePortfolios', () => {
  it('measures each portfolio until the next one starts, and the newest to the latest close', () => {
    const portfolios: PaperPortfolio[] = [
      { month: '2026-02', date: day(5), holdings: [{ symbol: 'B.NS', name: 'B', close: 40 }], universe: [], niftyClose: 1040 },
      {
        month: '2026-01',
        date: day(0),
        holdings: [{ symbol: 'A.NS', name: 'A', close: 100 }],
        universe: [
          { symbol: 'A.NS', close: 100 },
          { symbol: 'B.NS', close: 50 },
        ],
        niftyClose: 1000,
      },
    ];
    const report = evaluatePortfolios(portfolios, histories, new Date('2026-02-01'));
    const [first, second] = report.portfolios;
    expect(first.month).toBe('2026-01');
    expect(first.endDate).toBe(day(5));
    expect(first.open).toBe(false);
    expect(first.return).toBeCloseTo(0.1);
    expect(first.universeReturn).toBeCloseTo((0.1 - 0.2) / 2);
    expect(first.niftyReturn).toBeCloseTo(0.04);
    expect(second.open).toBe(true);
    expect(second.return).toBeCloseTo(45 / 40 - 1);
    expect(report.total.portfolio).toBeCloseTo(1.1 * 1.125 - 1);
    expect(report.total.universe).toBeCloseTo(0.95 - 1);
  });
});

describe('pickPortfolio', () => {
  it('holds the top 20% of the ranking at the latest closes', () => {
    const scores = { asOf: a.lastDate, stocks: { 'A.NS': { rank: 2 }, 'B.NS': { rank: 1 }, 'C.NS': { rank: 3 }, 'D.NS': { rank: null } } };
    const portfolio = pickPortfolio(scores, a.lastDate, histories)!;
    expect(portfolio.holdings).toEqual([{ symbol: 'B.NS', name: 'B.NS Ltd', close: 45 }]);
    expect(portfolio.universe.map((u) => u.symbol)).toEqual(['B.NS', 'A.NS']);
    expect(portfolio.niftyClose).toBe(1050);
    expect(pickPortfolio({ ...scores, asOf: '2020-01-01' }, a.lastDate, histories)).toBeNull();
  });
});
