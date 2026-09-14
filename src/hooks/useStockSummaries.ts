import { useEffect, useState } from 'react';
import { summarize, type StockSummary } from '../lib/analyze.ts';
import { loadHistory } from '../lib/data/loadHistory.ts';

export type SummaryRow =
  | { symbol: string; status: 'loading' }
  | { symbol: string; status: 'error'; message: string }
  | { symbol: string; status: 'ready'; summary: StockSummary };

const PARALLEL_LOADS = 3;

/** Loads and forecasts each stock in the browser, a few at a time so the page stays responsive. */
export function useStockSummaries(symbols: string[]): SummaryRow[] {
  const [rows, setRows] = useState<Record<string, SummaryRow>>({});
  const key = symbols.join(',');

  useEffect(() => {
    const controller = new AbortController();
    const queue = key ? key.split(',') : [];

    async function loadNext() {
      for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
        let row: SummaryRow;
        try {
          const history = await loadHistory(symbol, { signal: controller.signal });
          await new Promise((resolve) => setTimeout(resolve)); // let the table repaint between forecasts
          row = { symbol, status: 'ready', summary: summarize(history) };
        } catch (err) {
          row = { symbol, status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
        if (controller.signal.aborted) return;
        setRows((current) => ({ ...current, [symbol]: row }));
      }
    }

    for (let i = 0; i < PARALLEL_LOADS; i++) void loadNext();
    return () => controller.abort();
  }, [key]);

  return symbols.map((symbol) => rows[symbol] ?? { symbol, status: 'loading' });
}
