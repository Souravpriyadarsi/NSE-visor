// Minimal Margin Maximus test for every built-in stock: each share count, with and without charges, over each
// period and each trigger/trail rule. Writes public/research/margin-maximus.json for the Tests page's all-stocks
// table. Run `npm run fetch-data` first.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import {
  accountOf,
  dailySessions,
  marginMaximusKey,
  planTrades,
  TRAIL_RULES,
  type MarginMaximusSummary,
} from '../src/lib/tests/marginMaximus.ts';
import { periodStart, previousPeriodChange, TEST_PERIODS, TEST_SHARES } from '../src/lib/tests/sameDay.ts';
import type { HistoryFile, Manifest } from '../src/types.ts';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const OUT_DIR = new URL('../public/research/', import.meta.url);
const rupees = (value: number) => Math.round(value);

const manifest = JSON.parse(await readFile(new URL('index.json', DATA_DIR), 'utf8')) as Manifest;
const summary: MarginMaximusSummary = { generatedAt: new Date().toISOString(), stocks: [] };

for (const entry of manifest.symbols.filter((e) => !e.symbol.startsWith('^'))) {
  const history = JSON.parse(await readFile(new URL(entry.file, DATA_DIR), 'utf8')) as HistoryFile;
  const results: MarginMaximusSummary['stocks'][number]['results'] = {};

  for (const period of TEST_PERIODS) {
    const { sessions } = dailySessions(history, periodStart(period.key, history.lastDate));
    if (sessions.length < 2) continue;
    const closes = sessions.map((session) => session.bars[0].close);
    const holdingPerShare = closes[closes.length - 1] - closes[0];

    for (const rule of TRAIL_RULES) {
      // Buying and selling never depend on the share count or the charges, so each rule is only simulated once.
      const plans = { best: planTrades(sessions, rule, false), worst: planTrades(sessions, rule, true) };
      for (const shares of TEST_SHARES) {
        const gross = { best: accountOf(plans.best, { shares, withCosts: false }), worst: accountOf(plans.worst, { shares, withCosts: false }) };
        const net = { best: accountOf(plans.best, { shares, withCosts: true }), worst: accountOf(plans.worst, { shares, withCosts: true }) };
        results[marginMaximusKey(shares, period.key, rule.key)] = [
          rupees(Math.max(gross.best.peakCapital, gross.worst.peakCapital)),
          rupees(shares * holdingPerShare),
          rupees(gross.worst.profit),
          rupees(gross.best.profit),
          rupees(net.worst.profit),
          rupees(net.best.profit),
        ];
      }
    }
  }
  const before: MarginMaximusSummary['stocks'][number]['before'] = {};
  for (const period of TEST_PERIODS) {
    const change = previousPeriodChange(history, periodStart(period.key, history.lastDate));
    if (change != null) before[period.key] = Number(change.toFixed(4));
  }
  summary.stocks.push({ symbol: entry.symbol, name: entry.name, results, before });
}

await mkdir(OUT_DIR, { recursive: true });
const file = new URL('margin-maximus.json', OUT_DIR);
await writeFile(file, JSON.stringify(summary));
console.log(`${summary.stocks.length} stocks, ${Math.round((await stat(file)).size / 1024)} KB`);

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const cells = summary.stocks.map((s) => s.results[marginMaximusKey(100, '1Y', '2')]).filter(Boolean);
const money = (i: number) => `₹${median(cells.map((c) => c[i])).toLocaleString('en-IN')}`;
console.log(`100 shares over 1 year with the ₹2/₹1 rule, median of ${cells.length} stocks:`);
console.log(`  peak capital ${money(0)}, holding ${money(1)}`);
console.log(`  before charges ${money(2)} to ${money(3)}, after charges ${money(4)} to ${money(5)}`);
