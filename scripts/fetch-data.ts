// Downloads daily history into public/data/ for every built-in stock (symbols.json) and every
// stock added to daily tracking, and writes index.json with each stock's latest forecast.
// Usage: npm run fetch-data            (all stocks)
//        npm run fetch-data -- TCS INFY (only these)
// Optional env: YAHOO_PROXY_URL (the Worker, for its /tracked list), PAGES_URL (fallback to deployed data).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { summarize } from '../src/lib/analyze.ts';
import { fileId, isValidSymbol, normalizeSymbol } from '../src/lib/data/symbols.ts';
import { parseChart } from '../src/lib/data/yahoo.ts';
import type { HistoryFile, Manifest, ManifestEntry, SymbolInfo } from '../src/types.ts';
import { NSE_EQUITY_LIST_URL, parseEquityList, type StockListFile } from '../src/lib/data/stockList.ts';
import { fetchChart, sleep, USER_AGENT } from './yahoo-fetch.ts';

type Target = SymbolInfo & { source: ManifestEntry['source'] };

const OUT_DIR = new URL('../public/data/', import.meta.url);
const DELAY_MS = 1500;
const MAX_MISSING_RATIO = 0.2;
const pagesUrl = process.env.PAGES_URL?.replace(/\/$/, '');

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Stocks added from the app's "Track daily" button. Falls back to yesterday's list if the Worker is down. */
async function trackedStocks(): Promise<SymbolInfo[]> {
  const worker = process.env.YAHOO_PROXY_URL?.trim().replace(/\/$/, '');
  if (worker) {
    const list = await getJson<SymbolInfo[]>(`${worker}/tracked`);
    if (Array.isArray(list)) return list.filter((s) => isValidSymbol(s.symbol) && typeof s.name === 'string');
    console.warn('Could not read the tracked-stocks list from the Worker.');
  }
  const deployed = pagesUrl ? await getJson<Manifest>(`${pagesUrl}/data/index.json`) : null;
  return deployed?.symbols.filter((e) => e.source === 'tracked') ?? [];
}

async function readManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(new URL('index.json', OUT_DIR), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Saves NSE's list of every listed stock for the app's search. Keeps yesterday's list if NSE's download fails. */
async function saveStockList(): Promise<void> {
  let file: StockListFile | null = null;
  try {
    const res = await fetch(NSE_EQUITY_LIST_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stocks = parseEquityList(await res.text());
    if (stocks.length < 1000) throw new Error(`only ${stocks.length} stocks in the file`);
    file = { updatedAt: new Date().toISOString(), stocks };
  } catch (err) {
    console.warn(`Could not download NSE's stock list: ${err instanceof Error ? err.message : String(err)}`);
    file = pagesUrl ? await getJson<StockListFile>(`${pagesUrl}/data/nse-stocks.json`) : null;
    if (file) console.warn('      using the previously deployed list');
  }
  if (!file) return;
  await writeFile(new URL('nse-stocks.json', OUT_DIR), JSON.stringify(file));
  console.log(`NSE stock list: ${file.stocks.length} stocks\n`);
}

function toEntry(history: HistoryFile, source: Target['source'], file: string): ManifestEntry {
  const summary = summarize(history);
  return {
    symbol: history.symbol,
    name: history.name,
    source,
    file,
    lastDate: summary.lastDate,
    lastClose: summary.lastClose,
    dayChange: summary.dayChange,
    predicted: summary.predicted == null ? null : Number(summary.predicted.toFixed(2)),
    expectedChange: summary.expectedChange,
    probUp: summary.probUp,
  };
}

const builtIn = (JSON.parse(await readFile(new URL('../symbols.json', import.meta.url), 'utf8')) as SymbolInfo[]).map(
  (s): Target => ({ ...s, source: 'built-in' }),
);
const tracked = (await trackedStocks())
  .filter((s) => !builtIn.some((b) => b.symbol === s.symbol))
  .map((s): Target => ({ ...s, source: 'tracked' }));
const everything = [...builtIn, ...tracked];

const requested = process.argv.slice(2).map(normalizeSymbol);
const targets: Target[] = requested.length
  ? requested.map((symbol) => everything.find((s) => s.symbol === symbol) ?? { symbol, name: symbol, source: 'tracked' })
  : everything;

await mkdir(OUT_DIR, { recursive: true });
await saveStockList();
const entries: ManifestEntry[] = [];
const failed: string[] = [];
let missing = 0;

for (const [index, target] of targets.entries()) {
  if (index > 0) await sleep(DELAY_MS);
  let history: HistoryFile | null = null;
  try {
    history = parseChart(await fetchChart(target.symbol), { symbol: target.symbol, name: target.name });
    console.log(`ok    ${target.symbol.padEnd(16)} ${history.rows.length} rows, last ${history.lastDate}`);
  } catch (err) {
    failed.push(target.symbol);
    console.warn(`FAIL  ${target.symbol.padEnd(16)} ${err instanceof Error ? err.message : String(err)}`);
    history = pagesUrl ? await getJson<HistoryFile>(`${pagesUrl}/data/${fileId(target.symbol)}.json`) : null;
    if (history) console.warn(`      using previously deployed data (last ${history.lastDate})`);
  }
  if (!history) {
    missing++;
    continue;
  }
  const file = `${fileId(target.symbol)}.json`;
  await writeFile(new URL(file, OUT_DIR), JSON.stringify(history));
  entries.push(toEntry(history, target.source, file));
}

// When refreshing only some symbols, keep the other entries already in the index.
const refreshed = new Set(targets.map((t) => t.symbol));
const kept = requested.length ? ((await readManifest())?.symbols ?? []).filter((e) => !refreshed.has(e.symbol)) : [];
const manifest: Manifest = { updatedAt: new Date().toISOString(), failed, symbols: [...kept, ...entries] };
await writeFile(new URL('index.json', OUT_DIR), JSON.stringify(manifest, null, 1));

console.log(`\n${entries.length}/${targets.length} stocks written (${tracked.length} tracked), ${failed.length} fetch failures, ${missing} with no data.`);
if (missing / targets.length > MAX_MISSING_RATIO) {
  console.error(`More than ${MAX_MISSING_RATIO * 100}% of stocks have no data; failing.`);
  process.exit(1);
}
