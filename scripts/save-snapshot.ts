// Saves today's forecast for every stock in public/data/ as snapshots/<market date>.json: the daily "sheet" the
// Tracker later compares with what actually happened. Sheets are never overwritten, so saved predictions stay honest.
// On the first update of each month it also saves a paper portfolio (the top 20% of the research ranking) to
// snapshots/portfolios/<YYYY-MM>.json.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { pickPortfolio } from '../src/lib/portfolio.ts';
import type { ResearchScores } from '../src/lib/research/research.ts';
import { makeSnapshot } from '../src/lib/tracker.ts';
import type { HistoryFile, Manifest } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const SNAPSHOT_DIR = new URL('../snapshots/', import.meta.url);
const PORTFOLIO_DIR = new URL('portfolios/', SNAPSHOT_DIR);
const SCORES_FILE = new URL('../public/research/scores.json', import.meta.url);

const readJson = async <T>(url: URL) => JSON.parse(await readFile(url, 'utf8')) as T;
const exists = (url: URL) =>
  access(url).then(
    () => true,
    () => false,
  );

const manifest = await readJson<Manifest>(new URL('index.json', DATA_DIR));
const histories = await Promise.all(manifest.symbols.map((e) => readJson<HistoryFile>(new URL(e.file, DATA_DIR))));
const snapshot = makeSnapshot(histories, new Date());

if (!snapshot.date) {
  console.error('No forecasts to save.');
  process.exit(1);
}

const sheet = new URL(`${snapshot.date}.json`, SNAPSHOT_DIR);
if (await exists(sheet)) {
  console.log(`A sheet for ${snapshot.date} is already saved; keeping the original.`);
} else {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(sheet, JSON.stringify(snapshot));
  console.log(`Saved the ${snapshot.date} sheet with ${snapshot.stocks.length} stocks.`);
}

const portfolioFile = new URL(`${snapshot.date.slice(0, 7)}.json`, PORTFOLIO_DIR);
if (!(await exists(SCORES_FILE))) {
  console.log('No research scores, so no paper portfolio was saved.');
} else if (await exists(portfolioFile)) {
  console.log("This month's paper portfolio is already saved.");
} else {
  const scores = await readJson<ResearchScores>(SCORES_FILE);
  const portfolio = pickPortfolio(scores, snapshot.date, new Map(histories.map((h) => [h.symbol, h])));
  if (!portfolio) {
    console.log(`Research scores are from ${scores.asOf}, not ${snapshot.date}; no paper portfolio saved.`);
  } else {
    await mkdir(PORTFOLIO_DIR, { recursive: true });
    await writeFile(portfolioFile, JSON.stringify(portfolio));
    console.log(`Saved the ${portfolio.month} paper portfolio with ${portfolio.holdings.length} stocks.`);
  }
}
