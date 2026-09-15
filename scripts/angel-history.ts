// Saves Angel One candles for some stocks to data-local/candles/<interval>/<STOCK>/<YYYY-MM>.json, for research on
// more history than Yahoo keeps. Needs your SmartAPI details in .env.local (see .env.example).
// Usage: npm run angel-history -- RELIANCE INFY [--days 365] [--interval 1m|5m]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SmartApi } from '../src/lib/angel/api.ts';
import { ANGEL_INTERVALS, candleRanges, candlesToHistory, type CandleRow } from '../src/lib/angel/candles.ts';
import { readAngelConfig } from '../src/lib/angel/config.ts';
import { fileId, isValidSymbol, normalizeSymbol } from '../src/lib/data/symbols.ts';
import { mergeSessions, type IntradayHistory, type IntradaySession } from '../src/lib/intraday/bars.ts';
import { angelTokens } from './angel/tokens.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const interval = option('interval') === '5m' ? '5m' : '1m';
const days = Math.max(1, Math.round(Number(option('days') ?? 30)) || 30);
const symbols = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')).map(normalizeSymbol).filter(isValidSymbol);

if (symbols.length === 0) {
  console.error('Usage: npm run angel-history -- RELIANCE INFY [--days 365] [--interval 1m|5m]');
  process.exit(1);
}
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

const api = new SmartApi(config.credentials);
const { tokens } = await angelTokens();
const outDir = new URL(`../data-local/candles/${interval}/`, import.meta.url);

for (const symbol of symbols) {
  const token = tokens[symbol];
  if (!token) {
    console.warn(`SKIP  ${symbol}: not in Angel One's NSE list`);
    continue;
  }
  const rows: CandleRow[] = [];
  for (const [from, to] of candleRanges(interval, days, new Date())) rows.push(...(await api.candles(token, ANGEL_INTERVALS[interval], from, to)));
  const history = candlesToHistory(symbol, interval, rows);

  const byMonth = new Map<string, IntradaySession[]>();
  for (const session of history.sessions) byMonth.set(session.date.slice(0, 7), [...(byMonth.get(session.date.slice(0, 7)) ?? []), session]);
  const dir = new URL(`${fileId(symbol)}/`, outDir);
  await mkdir(dir, { recursive: true });
  for (const [month, sessions] of byMonth) {
    const file = new URL(`${month}.json`, dir);
    const saved = await readFile(file, 'utf8').then((text) => JSON.parse(text) as IntradayHistory, () => null);
    const out: IntradayHistory = { symbol, interval, sessions: mergeSessions(saved?.sessions ?? [], sessions) };
    await writeFile(file, JSON.stringify(out));
  }
  console.log(`ok    ${symbol.padEnd(16)} ${history.sessions.length} days of ${interval} candles (${history.sessions[0]?.date ?? '—'} to ${history.sessions.at(-1)?.date ?? '—'})`);
}
