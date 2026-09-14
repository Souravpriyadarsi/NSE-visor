// Research backtest over the NIFTY 200: how accurate the forecasts and ranges have been, and which stock-ranking
// signals have worked after costs, with the last 2 years sealed as a final test.
// Writes public/research/report.json (Model Report page) and scores.json (ranks and trust per stock).
// Run `npm run fetch-data` first.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { UniverseStock, UniverseFile } from '../src/lib/data/indexList.ts';
import { fileId } from '../src/lib/data/symbols.ts';
import type { ForecastSummary } from '../src/lib/research/forecastStudy.ts';
import { runResearch } from '../src/lib/research/research.ts';
import type { HistoryFile, SymbolInfo } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const OUT_DIR = new URL('../public/research/', import.meta.url);

async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T;
  } catch {
    return null;
  }
}

const readHistory = (symbol: string) => readJson<HistoryFile>(new URL(`${fileId(symbol)}.json`, DATA_DIR));
const pct = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`);

const universe = await readJson<UniverseFile>(new URL('universe.json', DATA_DIR));
const members: UniverseStock[] =
  universe?.stocks ??
  ((await readJson<SymbolInfo[]>(new URL('../symbols.json', import.meta.url))) ?? [])
    .filter((s) => !s.symbol.startsWith('^'))
    .map((s) => ({ ...s, industry: '' }));

const nifty = await readHistory('^NSEI');
if (!nifty) {
  console.error('No NIFTY 50 data. Run `npm run fetch-data` first.');
  process.exit(1);
}

const stocks: { history: HistoryFile; industry: string }[] = [];
for (const member of members) {
  const history = await readHistory(member.symbol);
  if (history) stocks.push({ history, industry: member.industry });
}
const universeName = universe?.index ?? 'NIFTY 50';
console.log(`Research universe: ${stocks.length}/${members.length} ${universeName} stocks with price data`);

const started = Date.now();
const { report, scores } = runResearch(
  { universeName, stocks, nifty, vix: await readHistory('^INDIAVIX'), now: new Date() },
  undefined,
  (done, total) => {
    if (done % 25 === 0 || done === total) console.log(`  forecasts replayed for ${done}/${total} stocks`);
  },
);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('report.json', OUT_DIR), JSON.stringify(report));
await writeFile(new URL('scores.json', OUT_DIR), JSON.stringify(scores));

function describe(label: string, s: ForecastSummary | null) {
  if (!s) return console.log(`${label}: no predictions`);
  const blend = s.models.find((m) => m.key === 'ensemble')!;
  const baseline = s.models.find((m) => m.key === 'baseline')!;
  console.log(
    `${label}: ${s.predictions} predictions over ${s.months} months | error ${pct(blend.error)} vs no-change ${pct(baseline.error)} | ` +
      `direction ${pct(blend.hitRate)} (95% ${pct(blend.ci[0])}–${pct(blend.ci[1])}) vs rose ${pct(s.upRate)} | ` +
      `range held: classic ${pct(s.coverageClassic)}, adaptive ${pct(s.coverageAdaptive)}, calibrated ${pct(s.coverageCalibrated)}`,
  );
}

const { forecasts, period, ranking } = report;
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s. Sealed test period: outcomes after ${period.holdoutStart}.`);
console.log(`Calibrated range scale: ${forecasts.rangeScale.toFixed(3)}`);
describe('Development', forecasts.dev);
describe('Sealed test ', forecasts.holdout);
console.log('\nRanking signals (top 20% after costs):');
for (const s of ranking.signals) {
  const test = s.holdout ? s.holdout.cagr - s.holdout.universeCagr : null;
  console.log(
    `  ${s.label.padEnd(26)} ${s.status.padEnd(13)} dev IC ${s.dev?.meanIc.toFixed(3) ?? '—'} (t ${s.dev?.icT.toFixed(1) ?? '—'}) | ` +
      `test vs average stock ${pct(test)}/yr`,
  );
}
const grades = Object.values(scores.stocks).reduce<Record<string, number>>((count, s) => {
  count[s.trust.grade] = (count[s.trust.grade] ?? 0) + 1;
  return count;
}, {});
console.log(`\nTrust grades: ${JSON.stringify(grades)}`);
