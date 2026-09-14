import type { HistoryFile, Row, SymbolInfo } from '../types.ts';
import { analyze } from './analyze.ts';
import { HORIZON } from './models/ensemble.ts';

/** One stock's forecast as saved on a given evening. Paths are the next 22 trading days. */
export type SnapshotStock = SymbolInfo & { asOf: string; close: number; mid: number[]; low: number[]; high: number[] };

/** Everything predicted on one day: the saved "sheet". */
export type Snapshot = { date: string; savedAt: string; stocks: SnapshotStock[] };

export type TrackedPrediction = {
  madeOn: string;
  close: number;
  predicted: number;
  low: number;
  high: number;
  path: number[];
  /** Close 22 trading days after madeOn, once that day has happened. */
  actual: { date: string; close: number } | null;
  /** Trading days that have passed since the prediction (0 to 22). */
  elapsed: number;
};

export type TrackerStock = SymbolInfo & { actual: [date: string, close: number][]; predictions: TrackedPrediction[] };

export type SheetRow = SymbolInfo & {
  close: number;
  predicted: number;
  low: number;
  high: number;
  actual: number | null;
  actualDate: string | null;
  latest: number | null;
  elapsed: number;
};

export type TrackerSheet = { date: string; rows: SheetRow[] };

export type Score = { matured: number; avgError: number | null; directionHits: number; insideRange: number };

export type TrackerIndex = { updatedAt: string; dates: string[]; stocks: SymbolInfo[]; score: Score };

const round = (value: number) => Number(value.toFixed(2));

export function makeSnapshot(histories: HistoryFile[], savedAt: Date): Snapshot {
  const stocks: SnapshotStock[] = [];
  for (const history of histories) {
    const { forecast } = analyze(history);
    if (!forecast) continue;
    stocks.push({
      symbol: history.symbol,
      name: history.name,
      asOf: history.lastDate,
      close: history.rows[history.rows.length - 1][4],
      mid: forecast.mid.map(round),
      low: forecast.low.map(round),
      high: forecast.high.map(round),
    });
  }
  const date = stocks.reduce((latest, s) => (s.asOf > latest ? s.asOf : latest), '');
  // Stocks whose prices couldn't be refreshed today would repeat an older prediction, so leave them out.
  return { date, savedAt: savedAt.toISOString(), stocks: stocks.filter((s) => s.asOf === date) };
}

/** What happened after a prediction made on `madeOn`, using the stock's price history. */
export function matchActual(rows: Row[], madeOn: string, horizon = HORIZON) {
  const start = rows.findIndex((row) => row[0] === madeOn);
  if (start === -1) return { actual: null, elapsed: 0, latest: null };
  const elapsed = Math.min(rows.length - 1 - start, horizon);
  const target = rows[start + horizon];
  return {
    actual: target ? { date: target[0], close: target[4] } : null,
    elapsed,
    latest: elapsed > 0 ? rows[start + elapsed][4] : null,
  };
}

export function scorePredictions(items: { close: number; predicted: number; low: number; high: number; actual: number | null }[]): Score {
  const matured = items.filter((i): i is typeof i & { actual: number } => i.actual != null);
  if (matured.length === 0) return { matured: 0, avgError: null, directionHits: 0, insideRange: 0 };
  return {
    matured: matured.length,
    avgError: matured.reduce((sum, i) => sum + Math.abs(i.predicted - i.actual) / i.actual, 0) / matured.length,
    directionHits: matured.filter((i) => Math.sign(i.predicted - i.close) === Math.sign(i.actual - i.close)).length,
    insideRange: matured.filter((i) => i.actual >= i.low && i.actual <= i.high).length,
  };
}

/** Turns saved snapshots plus current price histories into the files the Tracker page reads. */
export function buildTracker(snapshots: Snapshot[], histories: Map<string, HistoryFile>, now: Date) {
  const ordered = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const bySymbol = new Map<string, TrackerStock>();
  const sheets: TrackerSheet[] = [];

  for (const snapshot of ordered) {
    const rows: SheetRow[] = [];
    for (const s of snapshot.stocks) {
      if (bySymbol.get(s.symbol)?.predictions.some((p) => p.madeOn === s.asOf)) continue;
      const history = histories.get(s.symbol);
      const match = history ? matchActual(history.rows, s.asOf) : { actual: null, elapsed: 0, latest: null };
      const last = HORIZON - 1;
      const prediction: TrackedPrediction = {
        madeOn: s.asOf,
        close: s.close,
        predicted: s.mid[last],
        low: s.low[last],
        high: s.high[last],
        path: s.mid,
        actual: match.actual,
        elapsed: match.elapsed,
      };

      let stock = bySymbol.get(s.symbol);
      if (!stock) {
        stock = { symbol: s.symbol, name: s.name, actual: [], predictions: [] };
        bySymbol.set(s.symbol, stock);
      }
      stock.name = s.name;
      stock.predictions.push(prediction);

      rows.push({
        symbol: s.symbol,
        name: s.name,
        close: s.close,
        predicted: prediction.predicted,
        low: prediction.low,
        high: prediction.high,
        actual: match.actual?.close ?? null,
        actualDate: match.actual?.date ?? null,
        latest: match.latest,
        elapsed: match.elapsed,
      });
    }
    sheets.push({ date: snapshot.date, rows });
  }

  for (const stock of bySymbol.values()) {
    const history = histories.get(stock.symbol);
    const firstDate = stock.predictions[0]?.madeOn;
    if (!history || !firstDate) continue;
    const start = Math.max(0, history.rows.findIndex((row) => row[0] >= firstDate) - HORIZON);
    stock.actual = history.rows.slice(start).map((row) => [row[0], row[4]]);
  }

  const stocks = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const index: TrackerIndex = {
    updatedAt: now.toISOString(),
    dates: sheets.map((s) => s.date),
    stocks: stocks.map(({ symbol, name }) => ({ symbol, name })),
    score: scorePredictions(stocks.flatMap((s) => s.predictions.map((p) => ({ ...p, actual: p.actual?.close ?? null })))),
  };
  return { index, stocks, sheets };
}
