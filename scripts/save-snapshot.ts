// Saves today's forecast for every stock in public/data/ as snapshots/<market date>.json:
// the daily "sheet" the Tracker later compares with what actually happened.
// An existing sheet for the same date is never overwritten, so saved predictions stay honest.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { makeSnapshot } from '../src/lib/tracker.ts';
import type { HistoryFile, Manifest } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const SNAPSHOT_DIR = new URL('../snapshots/', import.meta.url);

const readJson = async <T>(url: URL) => JSON.parse(await readFile(url, 'utf8')) as T;

const manifest = await readJson<Manifest>(new URL('index.json', DATA_DIR));
const histories = await Promise.all(manifest.symbols.map((e) => readJson<HistoryFile>(new URL(e.file, DATA_DIR))));
const snapshot = makeSnapshot(histories, new Date());

if (!snapshot.date) {
  console.error('No forecasts to save.');
  process.exit(1);
}

const target = new URL(`${snapshot.date}.json`, SNAPSHOT_DIR);
const exists = await access(target).then(
  () => true,
  () => false,
);
if (exists) {
  console.log(`A sheet for ${snapshot.date} is already saved; keeping the original.`);
} else {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(target, JSON.stringify(snapshot));
  console.log(`Saved the ${snapshot.date} sheet with ${snapshot.stocks.length} stocks.`);
}
