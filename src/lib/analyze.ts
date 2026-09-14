import type { Forecast, HistoryFile, Row } from '../types.ts';
import { SUSPICIOUS_LOG_MOVE } from './data/yahoo.ts';
import { macd, rsi, sma } from './indicators/indicators.ts';
import { computeSignals, type IndicatorSet, type Signal } from './indicators/signals.ts';
import { backtest, type BacktestResult } from './models/backtest.ts';
import { forecast, MIN_FORECAST_BARS } from './models/ensemble.ts';
import { hashString } from './random.ts';

export type Analysis = {
  dates: string[];
  closes: number[];
  indicators: IndicatorSet;
  signals: Signal[];
  forecast: Forecast | null;
  backtest: BacktestResult | null;
};

/**
 * Price series the models learn from: dividend-adjusted, with unadjusted split/demerger
 * gaps removed, and rescaled so it ends at the latest close.
 */
export function modelPrices(rows: Row[]): number[] {
  const prices = [rows[0][5]];
  for (let i = 1; i < rows.length; i++) {
    const move = Math.log(rows[i][5] / rows[i - 1][5]);
    prices.push(prices[i - 1] * (Math.abs(move) > SUSPICIOUS_LOG_MOVE ? 1 : Math.exp(move)));
  }
  const scale = rows[rows.length - 1][4] / prices[prices.length - 1];
  return prices.map((p) => p * scale);
}

export type StockSummary = {
  symbol: string;
  name: string;
  lastDate: string;
  lastClose: number;
  dayChange: number;
  predicted: number | null;
  expectedChange: number | null;
  probUp: number | null;
};

/** The headline numbers for one stock: latest price and where the forecast puts it in a month. */
export function summarize(history: HistoryFile): StockSummary {
  const { closes, forecast: result } = analyze(history);
  const lastClose = closes[closes.length - 1];
  const predicted = result ? result.mid[result.mid.length - 1] : null;
  return {
    symbol: history.symbol,
    name: history.name,
    lastDate: history.lastDate,
    lastClose,
    dayChange: closes.length > 1 ? lastClose / closes[closes.length - 2] - 1 : 0,
    predicted,
    expectedChange: predicted == null ? null : predicted / lastClose - 1,
    probUp: result?.probUp ?? null,
  };
}

// Tabs share results, so the same history object is only analyzed once.
const analyses = new WeakMap<HistoryFile, Analysis>();

export function analyze(history: HistoryFile): Analysis {
  let result = analyses.get(history);
  if (!result) {
    result = runAnalysis(history);
    analyses.set(history, result);
  }
  return result;
}

function runAnalysis(history: HistoryFile): Analysis {
  const dates = history.rows.map((row) => row[0]);
  const closes = history.rows.map((row) => row[4]);
  const prices = modelPrices(history.rows);
  const seed = hashString(`${history.symbol}:${history.lastDate}`);

  const indicators: IndicatorSet = {
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi: rsi(closes, 14),
    macd: macd(closes),
  };
  const backtestResult = backtest(prices, seed);

  return {
    dates,
    closes,
    indicators,
    signals: computeSignals(closes, indicators),
    forecast:
      prices.length >= MIN_FORECAST_BARS
        ? forecast(prices, history.lastDate, seed, backtestResult?.modelErrors ?? null)
        : null,
    backtest: backtestResult,
  };
}
