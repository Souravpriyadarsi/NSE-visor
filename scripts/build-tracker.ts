// Builds public/tracker/ from the saved sheets in snapshots/ and the latest prices in public/data/:
//   index.json            dates, stocks and the overall score
//   stocks/<file>.json    one stock's predictions over time plus its actual prices
//   sheets/<date>.json    one day's sheet with actual prices filled in where known
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileId } from '../src/lib/data/symbols.ts';
import { buildTracker, type Snapshot } from '../src/lib/tracker.ts';
import type { HistoryFile } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const SNAPSHOT_DIR = new URL('../snapshots/', import.meta.url);
const OUT_DIR = new URL('../public/tracker/', import.meta.url);

async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T;
  } catch {
    return null;
  }
}

const files = (await readdir(SNAPSHOT_DIR).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
const snapshots = (await Promise.all(files.map((f) => readJson<Snapshot>(new URL(f, SNAPSHOT_DIR))))).filter(
  (s): s is Snapshot => s != null,
);

const histories = new Map<string, HistoryFile>();
for (const symbol of new Set(snapshots.flatMap((s) => s.stocks.map((stock) => stock.symbol)))) {
  const history = await readJson<HistoryFile>(new URL(`${fileId(symbol)}.json`, DATA_DIR));
  if (history) histories.set(symbol, history);
}

const { index, stocks, sheets } = buildTracker(snapshots, histories, new Date());

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(new URL('stocks/', OUT_DIR), { recursive: true });
await mkdir(new URL('sheets/', OUT_DIR), { recursive: true });
await writeFile(new URL('index.json', OUT_DIR), JSON.stringify(index));
for (const stock of stocks) await writeFile(new URL(`stocks/${fileId(stock.symbol)}.json`, OUT_DIR), JSON.stringify(stock));
for (const sheet of sheets) await writeFile(new URL(`sheets/${sheet.date}.json`, OUT_DIR), JSON.stringify(sheet));

console.log(`Tracker: ${sheets.length} saved sheets, ${stocks.length} stocks, ${index.score.matured} predictions matured.`);
