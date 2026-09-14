// Downloads daily history into public/data/ for every built-in stock (the NIFTY 200, plus symbols.json and India VIX)
// and every stock added to daily tracking, and writes index.json with each stock's latest forecast.
// Also keeps monthly prices from before the daily history (data/long/) and writes prices.json for the Prices page.
// Usage: npm run fetch-data            (all stocks)
//        npm run fetch-data -- TCS INFY (only these)
// Optional env: YAHOO_PROXY_URL (the Worker, for its /tracked list), PAGES_URL (fallback to deployed data).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { summarize } from '../src/lib/analyze.ts';
import { fileId, isValidSymbol, normalizeSymbol } from '../src/lib/data/symbols.ts';
import { parseChart } from '../src/lib/data/yahoo.ts';
import type { HistoryFile, Manifest, ManifestEntry, SymbolInfo } from '../src/types.ts';
import { NSE_EQUITY_LIST_URL, parseEquityList, type StockListFile } from '../src/lib/data/stockList.ts';
import { NIFTY_200_URL, parseIndexList, type UniverseFile } from '../src/lib/data/indexList.ts';
import {
  longHistoryAgrees,
  needsLongHistory,
  summarizePrices,
  toLongHistory,
  type LongHistoryFile,
  type PriceSummary,
} from '../src/lib/prices.ts';
import { fetchChart, sleep, USER_AGENT } from './yahoo-fetch.ts';

type Target = SymbolInfo & { source: ManifestEntry['source'] };

const OUT_DIR = new URL('../public/data/', import.meta.url);
const LONG_DIR = new URL('long/', OUT_DIR);
/** Old monthly prices rarely change, so they're only downloaded again after this long (or after a split). */
const LONG_MAX_AGE_DAYS = 30;
const DELAY_MS = 1500;
const MAX_MISSING_RATIO = 0.2;
/** Downloaded for the market-regime check only, so not listed on the Dashboard. */
const REGIME_ONLY = new Set(['^INDIAVIX']);
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

async function readLocalJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T;
  } catch {
    return null;
  }
}

const readManifest = () => readLocalJson<Manifest>(new URL('index.json', OUT_DIR));

/**
 * Monthly prices back to the first price on record, for stocks whose daily history reaches the 10-year limit.
 * Reuses the saved or deployed copy unless it's a month old or no longer matches the daily prices.
 */
async function updateLongHistory(history: HistoryFile): Promise<void> {
  if (!needsLongHistory(history)) return;
  const file = `${fileId(history.symbol)}.json`;
  const saved =
    (await readLocalJson<LongHistoryFile>(new URL(file, LONG_DIR))) ??
    (pagesUrl ? await getJson<LongHistoryFile>(`${pagesUrl}/data/long/${file}`) : null);
  const ageDays = saved ? (Date.now() - Date.parse(saved.fetchedAt)) / 86_400_000 : Infinity;
  let long = saved && ageDays < LONG_MAX_AGE_DAYS && longHistoryAgrees(saved, history) ? saved : null;

  if (!long) {
    try {
      await sleep(DELAY_MS);
      const monthly = parseChart(await fetchChart(history.symbol, 3, 'range=max&interval=1mo'), { symbol: history.symbol, quiet: true });
      long = toLongHistory(monthly, new Date().toISOString());
      console.log(`      monthly prices since ${long.bars[0][0]}`);
    } catch (err) {
      console.warn(`      no monthly prices: ${err instanceof Error ? err.message : String(err)}`);
      long = saved;
    }
  }
  if (long) await writeFile(new URL(file, LONG_DIR), JSON.stringify(long));
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

/** NIFTY 200 members, the research universe. Keeps the deployed list if NSE's download fails. */
async function loadUniverse(): Promise<UniverseFile | null> {
  let file: UniverseFile | null = null;
  try {
    const res = await fetch(NIFTY_200_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stocks = parseIndexList(await res.text());
    if (stocks.length < 150) throw new Error(`only ${stocks.length} stocks in the file`);
    file = { updatedAt: new Date().toISOString(), index: 'NIFTY 200', stocks };
  } catch (err) {
    console.warn(`Could not download the NIFTY 200 list: ${err instanceof Error ? err.message : String(err)}`);
    file = pagesUrl ? await getJson<UniverseFile>(`${pagesUrl}/data/universe.json`) : null;
    if (file) console.warn('      using the previously deployed list');
  }
  if (!file) return null;
  await writeFile(new URL('universe.json', OUT_DIR), JSON.stringify(file));
  console.log(`NIFTY 200 list: ${file.stocks.length} stocks\n`);
  return file;
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

await mkdir(LONG_DIR, { recursive: true });
await saveStockList();
const universe = await loadUniverse();

// symbols.json first, so its shorter company names win over NSE's.
const builtIn: Target[] = [];
for (const stock of [
  ...(JSON.parse(await readFile(new URL('../symbols.json', import.meta.url), 'utf8')) as SymbolInfo[]),
  ...(universe?.stocks ?? []),
  { symbol: '^INDIAVIX', name: 'India VIX' },
]) {
  if (!builtIn.some((b) => b.symbol === stock.symbol)) builtIn.push({ symbol: stock.symbol, name: stock.name, source: 'built-in' });
}
const tracked = (await trackedStocks())
  .filter((s) => !builtIn.some((b) => b.symbol === s.symbol))
  .map((s): Target => ({ ...s, source: 'tracked' }));
const everything = [...builtIn, ...tracked];

const requested = process.argv.slice(2).map(normalizeSymbol);
const targets: Target[] = requested.length
  ? requested.map((symbol) => everything.find((s) => s.symbol === symbol) ?? { symbol, name: symbol, source: 'tracked' })
  : everything;

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
  if (REGIME_ONLY.has(target.symbol)) continue;
  entries.push(toEntry(history, target.source, file));
  await updateLongHistory(history);
}

// When refreshing only some symbols, keep the other entries already in the index.
const refreshed = new Set(targets.map((t) => t.symbol));
const kept = requested.length ? ((await readManifest())?.symbols ?? []).filter((e) => !refreshed.has(e.symbol)) : [];
const manifest: Manifest = { updatedAt: new Date().toISOString(), failed, symbols: [...kept, ...entries] };
await writeFile(new URL('index.json', OUT_DIR), JSON.stringify(manifest, null, 1));

// Prices page table: every listed stock's price at the start of each range.
const prices: PriceSummary = { updatedAt: manifest.updatedAt, stocks: [] };
for (const entry of manifest.symbols) {
  const history = await readLocalJson<HistoryFile>(new URL(entry.file, OUT_DIR));
  if (history?.rows.length) prices.stocks.push(summarizePrices(history, await readLocalJson<LongHistoryFile>(new URL(entry.file, LONG_DIR))));
}
await writeFile(new URL('prices.json', OUT_DIR), JSON.stringify(prices));

console.log(`\n${entries.length}/${targets.length} stocks written (${tracked.length} tracked), ${failed.length} fetch failures, ${missing} with no data.`);
if (missing / targets.length > MAX_MISSING_RATIO) {
  console.error(`More than ${MAX_MISSING_RATIO * 100}% of stocks have no data; failing.`);
  process.exit(1);
}
