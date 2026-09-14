import { describe, expect, it } from 'vitest';
import { parseChart } from './yahoo.ts';

const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:30`) / 1000;

function yahooResponse(timestamps: number[], close: (number | null)[], adjclose?: (number | null)[]) {
  return {
    chart: {
      result: [
        {
          meta: { exchangeTimezoneName: 'Asia/Kolkata', longName: 'Test Industries' },
          timestamp: timestamps,
          indicators: {
            quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 1000) }],
            ...(adjclose ? { adjclose: [{ adjclose }] } : {}),
          },
        },
      ],
      error: null,
    },
  };
}

const eveningOf = (date: string) => new Date(`${date}T18:00:00+05:30`);

describe('parseChart', () => {
  it('drops null rows, keeps the last duplicate of a date and sorts rows', () => {
    const json = yahooResponse(
      [at('2026-09-09', '09:15'), at('2026-09-08', '09:15'), at('2026-09-10', '09:15'), at('2026-09-10', '15:30'), at('2026-09-11', '09:15')],
      [101, 100, 99, 102, null],
    );
    const history = parseChart(json, { symbol: 'TEST.NS', now: eveningOf('2026-09-11') });
    expect(history.rows.map((r) => r[0])).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(history.rows[2][4]).toBe(102);
    expect(history.lastDate).toBe('2026-09-10');
    expect(history.name).toBe('Test Industries');
  });

  it('uses close when adjusted close is missing, and adjusted close when present', () => {
    const ts = [at('2026-09-09', '09:15'), at('2026-09-10', '09:15')];
    expect(parseChart(yahooResponse(ts, [100, 101]), { symbol: 'T.NS', now: eveningOf('2026-09-11') }).rows[0][5]).toBe(100);
    expect(parseChart(yahooResponse(ts, [100, 101], [95.5, 96]), { symbol: 'T.NS', now: eveningOf('2026-09-11') }).rows[0][5]).toBe(95.5);
  });

  it("drops today's bar while the market is still open", () => {
    const json = yahooResponse([at('2026-09-10', '09:15'), at('2026-09-11', '09:15')], [100, 101]);
    expect(parseChart(json, { symbol: 'T.NS', now: new Date('2026-09-11T11:00:00+05:30') }).lastDate).toBe('2026-09-10');
    expect(parseChart(json, { symbol: 'T.NS', now: new Date('2026-09-11T16:00:00+05:30') }).lastDate).toBe('2026-09-11');
  });

  it('throws on Yahoo errors and malformed responses', () => {
    const notFound = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };
    expect(() => parseChart(notFound, { symbol: 'NOPE.NS' })).toThrow(/No data found/);
    expect(() => parseChart({}, { symbol: 'NOPE.NS' })).toThrow(/Unexpected/);
  });
});
