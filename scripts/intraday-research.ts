// Backtests the Day trading page's intraday strategies for every NIFTY 50 stock (symbols.json) on ~60 trading days of
// 5-minute prices from Yahoo Finance, and writes public/research/intraday.json. It also keeps each finished day's bars in
// snapshots/intraday/<stock>/<YYYY-MM>.json (the "predictions" branch in GitHub Actions), building a longer history
// than Yahoo's 60 days for stronger tests later.
// Locally, `npm run intraday-research -- --source angel` uses Angel One's ~100 days of 5-minute candles (needs .env.local).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SmartApi } from '../src/lib/angel/api.ts';
import { candleRanges, candlesToHistory, type CandleRow } from '../src/lib/angel/candles.ts';
import { readAngelConfig } from '../src/lib/angel/config.ts';
import { fileId } from '../src/lib/data/symbols.ts';
import {
  completedSessions,
  istMinute,
  MARKET_CLOSE_MINUTE,
  mergeSessions,
  parseIntraday,
  type IntradayHistory,
  type IntradaySession,
} from '../src/lib/intraday/bars.ts';
import { walkForward, type IntradayResearch } from '../src/lib/intraday/evaluate.ts';
import { prepareBars } from '../src/lib/intraday/indicators.ts';
import { DEFAULT_RISK } from '../src/lib/intraday/risk.ts';
import { STRATEGIES } from '../src/lib/intraday/strategies.ts';
import type { SymbolInfo } from '../src/types.ts';
import { angelTokens } from './angel/tokens.ts';
import { fetchChart, sleep } from './yahoo-fetch.ts';

const OUT_DIR = new URL('../public/research/', import.meta.url);
const BARS_DIR = new URL('../snapshots/intraday/', import.meta.url);
const DELAY_MS = 1500;
const pct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Adds finished days to the monthly bar files, keeping whichever copy of a day has more bars. */
async function saveBars(history: IntradayHistory): Promise<void> {
  const finished = history.sessions.filter((s) => istMinute(s.bars[s.bars.length - 1][0]) + 5 >= MARKET_CLOSE_MINUTE);
  const byMonth = new Map<string, IntradaySession[]>();
  for (const session of finished) {
    const month = session.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), session]);
  }
  const dir = new URL(`${fileId(history.symbol)}/`, BARS_DIR);
  await mkdir(dir, { recursive: true });
  for (const [month, sessions] of byMonth) {
    const file = new URL(`${month}.json`, dir);
    const saved = await readJson<IntradayHistory>(file);
    const out: IntradayHistory = { symbol: history.symbol, interval: '5m', sessions: mergeSessions(saved?.sessions ?? [], sessions) };
    await writeFile(file, JSON.stringify(out));
  }
}

const useAngel = process.argv.includes('--source=angel') || process.argv.join(' ').includes('--source angel');
let angel: { api: SmartApi; tokens: Record<string, string> } | null = null;
if (useAngel) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: readAngelConfig explains below.
  }
  const config = readAngelConfig(process.env);
  if (!config) {
    console.error('Add your Angel One SmartAPI details to .env.local first (copy .env.example).');
    process.exit(1);
  }
  angel = { api: new SmartApi(config.credentials), tokens: (await angelTokens()).tokens };
}

async function loadHistory(symbol: string): Promise<IntradayHistory> {
  if (!angel) return parseIntraday(await fetchChart(symbol, 3, 'range=60d&interval=5m'), { symbol, interval: '5m' });
  const token = angel.tokens[symbol];
  if (!token) throw new Error("not in Angel One's NSE list");
  const rows: CandleRow[] = [];
  for (const [from, to] of candleRanges('5m', 100, new Date())) rows.push(...(await angel.api.candles(token, 'FIVE_MINUTE', from, to)));
  return candlesToHistory(symbol, '5m', rows);
}

const stocks = (JSON.parse(await readFile(new URL('../symbols.json', import.meta.url), 'utf8')) as SymbolInfo[]).filter(
  (s) => !s.symbol.startsWith('^'),
);
const research: IntradayResearch = { generatedAt: new Date().toISOString(), interval: '5m', risk: DEFAULT_RISK, stocks: [] };

for (const [index, stock] of stocks.entries()) {
  if (index > 0 && !angel) await sleep(DELAY_MS);
  try {
    const history = await loadHistory(stock.symbol);
    if (history.sessions.length === 0) throw new Error('no 5-minute prices');
    const data = prepareBars({ ...history, sessions: completedSessions(history) });
    const entry: IntradayResearch['stocks'][number] = {
      symbol: stock.symbol,
      name: stock.name,
      sessions: data.sessions.length,
      firstDate: data.sessions[0]?.date ?? '',
      lastDate: data.sessions[data.sessions.length - 1]?.date ?? '',
      testFrom: null,
      results: {},
    };
    for (const strategy of STRATEGIES) {
      const result = walkForward(data, strategy, DEFAULT_RISK);
      if (!result) continue;
      entry.testFrom = result.testFrom;
      entry.results[strategy.id] = { params: result.params, train: result.train, test: result.test, pass: result.pass, reasons: result.reasons };
    }
    research.stocks.push(entry);
    await saveBars(history);
    const summary = STRATEGIES.map((s) => {
      const r = entry.results[s.id];
      return r ? `${s.id} ${pct(r.test.netPct)}${r.pass ? ' PASS' : ''}` : `${s.id} —`;
    }).join('  ');
    console.log(`ok    ${stock.symbol.padEnd(16)} ${entry.sessions} days  ${summary}`);
  } catch (err) {
    console.warn(`FAIL  ${stock.symbol.padEnd(16)} ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (research.stocks.length === 0) {
  console.error('No intraday prices downloaded; not writing intraday.json.');
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('intraday.json', OUT_DIR), JSON.stringify(research));

console.log(`\n${research.stocks.length}/${stocks.length} stocks tested. On the unseen days:`);
for (const strategy of STRATEGIES) {
  const results = research.stocks.flatMap((s) => (s.results[strategy.id] ? [s.results[strategy.id]!] : []));
  const nets = results.map((r) => r.test.netPct).sort((a, b) => a - b);
  const median = nets.length ? nets[Math.floor(nets.length / 2)] : 0;
  console.log(`  ${strategy.name.padEnd(26)} passed ${results.filter((r) => r.pass).length}/${results.length}, median ${pct(median)} of capital`);
}
