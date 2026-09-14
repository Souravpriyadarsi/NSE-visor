// Same-day trading test for every built-in stock: each share count, with and without charges, over each period.
// Writes public/research/same-day.json for the Tests page's all-stocks table. Run `npm run fetch-data` first.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { periodStart, sameDayTest, summaryKey, TEST_PERIODS, TEST_SHARES, type SameDaySummary } from '../src/lib/tests/sameDay.ts';
import type { HistoryFile, Manifest } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const OUT_DIR = new URL('../public/research/', import.meta.url);
const round = (value: number) => Number(value.toFixed(4));

const manifest = JSON.parse(await readFile(new URL('index.json', DATA_DIR), 'utf8')) as Manifest;
const summary: SameDaySummary = { generatedAt: new Date().toISOString(), stocks: [] };

for (const entry of manifest.symbols.filter((e) => !e.symbol.startsWith('^'))) {
  const history = JSON.parse(await readFile(new URL(entry.file, DATA_DIR), 'utf8')) as HistoryFile;
  const results: SameDaySummary['stocks'][number]['results'] = {};
  for (const shares of TEST_SHARES) {
    for (const withCosts of [true, false]) {
      for (const period of TEST_PERIODS) {
        const result = sameDayTest(history, { shares, withCosts, from: periodStart(period.key, history.lastDate) });
        if (result) {
          results[summaryKey(shares, withCosts, period.key)] = [
            round(result.stock.totalReturn),
            round(result.overnight.totalReturn),
            round(result.intraday.totalReturn),
          ];
        }
      }
    }
  }
  summary.stocks.push({ symbol: entry.symbol, name: entry.name, results });
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('same-day.json', OUT_DIR), JSON.stringify(summary));

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
for (const withCosts of [false, true]) {
  const cells = summary.stocks.map((s) => s.results[summaryKey(100, withCosts, '1Y')]).filter(Boolean);
  const median = (i: number) => cells.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(cells.length / 2)];
  console.log(
    `100 shares over 1 year ${withCosts ? 'after' : 'before'} charges, median of ${cells.length} stocks: ` +
      `holding ${pct(median(0))}, overnight ${pct(median(1))}, intraday ${pct(median(2))}`,
  );
}
