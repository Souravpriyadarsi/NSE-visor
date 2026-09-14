/** One trading day. Prices are split-adjusted; adjClose is also dividend-adjusted. */
export type Row = [date: string, open: number, high: number, low: number, close: number, adjClose: number, volume: number];

export type HistoryFile = {
  symbol: string;
  name: string;
  updatedAt: string;
  lastDate: string;
  rows: Row[];
};

export type SymbolInfo = { symbol: string; name: string };

/** built-in: symbols.json; tracked: added to daily tracking via the Worker; fetched: only in this browser. */
export type StockSource = 'built-in' | 'tracked' | 'fetched';

export type ManifestEntry = SymbolInfo & {
  source: Exclude<StockSource, 'fetched'>;
  file: string;
  lastDate: string;
  lastClose: number;
  dayChange: number;
  predicted: number | null;
  expectedChange: number | null;
  probUp: number | null;
};

export type Manifest = {
  updatedAt: string;
  failed: string[];
  symbols: ManifestEntry[];
};

export type ModelName = 'trend' | 'holt' | 'gbm';

export type Forecast = {
  dates: string[];
  mid: number[];
  low: number[];
  high: number[];
  perModel: Record<ModelName, number[]>;
  weights: Record<ModelName, number>;
  probUp: number;
};
