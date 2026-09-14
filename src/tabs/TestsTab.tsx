import { useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { GrowthChart, type GrowthLine } from '../components/GrowthChart.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useHistories } from '../hooks/useHistories.ts';
import { useHistory } from '../hooks/useHistory.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { loadSameDaySummary } from '../lib/data/loadStatic.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct } from '../lib/format.ts';
import { CHARGES } from '../lib/tests/costs.ts';
import { sameDayTest, summaryKey, TEST_AMOUNTS, TEST_PERIODS, type PeriodKey, type SeriesResult, type StrategyResult } from '../lib/tests/sameDay.ts';
import type { SymbolInfo } from '../types.ts';

type Settings = { amount: number; period: PeriodKey; withCosts: boolean };
type Props = { symbol: string; options: PickerOption[]; fetched: SymbolInfo[]; onSelectSymbol: (symbol: string) => void };

const rupees = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedPct = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? '—' : formatPct(value, true));
const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
const daysFor = (period: PeriodKey) => TEST_PERIODS.find((p) => p.key === period)!.days;
const periodLabel = (period: PeriodKey) => TEST_PERIODS.find((p) => p.key === period)!.label.toLowerCase();

const LINES = {
  holding: { label: 'Holding the stock (no charges)', color: CHART_COLORS.price },
  overnight: { label: 'Buy at close, sell next open', color: CHART_COLORS.forecast },
  intraday: { label: 'Buy at open, sell at close', color: CHART_COLORS.sma50 },
};

function Toggle<T extends string | number>(props: { label: string; value: T; choices: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-lg border border-ink-700 p-0.5" role="group" aria-label={props.label}>
      {props.choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          aria-pressed={choice.value === props.value}
          onClick={() => props.onChange(choice.value)}
          className={`rounded-md px-3 py-1 text-xs whitespace-nowrap ${
            choice.value === props.value ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function TestsTab({ symbol, options, fetched, onSelectSymbol }: Props) {
  const [settings, setSettings] = useState<Settings>({ amount: TEST_AMOUNTS[0], period: '1Y', withCosts: true });
  const stockOptions = useMemo(() => options.filter((o) => !o.symbol.startsWith('^')), [options]);
  const update = (change: Partial<Settings>) => setSettings((current) => ({ ...current, ...change }));

  return (
    <div className="space-y-6">
      <Card
        title="Same-day trading test"
        subtitle="What if you traded a stock every single day, reinvesting everything? Buy at the close and sell at the next open, or buy at the open and sell at that day's close. Compared with simply holding the stock."
      >
        <div className="flex flex-wrap items-center gap-3">
          <StockPicker options={stockOptions} onSelect={onSelectSymbol} placeholder="Pick a stock to test" />
          <Toggle
            label="Starting amount"
            value={settings.amount}
            choices={TEST_AMOUNTS.map((amount) => ({ value: amount, label: rupees(amount) }))}
            onChange={(amount) => update({ amount })}
          />
          <Toggle
            label="Period"
            value={settings.period}
            choices={TEST_PERIODS.map((p) => ({ value: p.key, label: p.label }))}
            onChange={(period) => update({ period })}
          />
          <Toggle
            label="Charges"
            value={settings.withCosts ? 'with' : 'without'}
            choices={[
              { value: 'with', label: 'With charges' },
              { value: 'without', label: 'Before charges' },
            ]}
            onChange={(choice) => update({ withCosts: choice === 'with' })}
          />
        </div>
      </Card>

      {symbol.startsWith('^') ? (
        <p className="rounded-xl border border-ink-800 p-5 text-sm text-ink-400">Indices can't be bought directly. Pick a stock above.</p>
      ) : (
        <StockTest symbol={symbol} settings={settings} />
      )}
      <AllStocks settings={settings} fetched={fetched} selected={symbol} onSelect={onSelectSymbol} />
      <ChargesCard />
    </div>
  );
}

function StockTest({ symbol, settings }: { symbol: string; settings: Settings }) {
  const { state, retry } = useHistory(symbol);
  const { amount, period, withCosts } = settings;
  const result = useMemo(
    () => (state.status === 'ready' ? sameDayTest(state.history, { amount, withCosts, days: daysFor(period) }) : null),
    [state, amount, withCosts, period],
  );
  const lines = useMemo<GrowthLine[]>(
    () =>
      result
        ? [
            { ...LINES.holding, values: result.stock.values },
            { ...LINES.overnight, values: result.overnight.values },
            { ...LINES.intraday, values: result.intraday.values },
          ]
        : [],
    [result],
  );

  if (state.status === 'loading') return <div className="h-[460px] animate-pulse rounded-xl bg-ink-900" />;
  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
        <p>{state.message}</p>
        {!state.unavailable && (
          <button type="button" onClick={retry} className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs hover:bg-rose-500/20">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!result) return <p className="rounded-xl border border-ink-800 p-5 text-sm text-ink-400">Not enough trading days to test.</p>;

  const tradingDays = result.dates.length - 1;
  const rows: { label: string; color: string; series: SeriesResult; strategy: StrategyResult | null }[] = [
    { ...LINES.holding, series: result.stock, strategy: null },
    { ...LINES.overnight, series: result.overnight, strategy: result.overnight },
    { ...LINES.intraday, series: result.intraday, strategy: result.intraday },
  ];
  const unaffordable = Math.max(result.overnight.unaffordableDays, result.intraday.unaffordableDays);
  const skipped = Math.max(result.overnight.skippedDays, result.intraday.skippedDays);

  return (
    <Card
      title={`${displaySymbol(symbol)} · ${state.history.name}`}
      subtitle={`${rupees(amount)} from ${formatDate(result.dates[0])} to ${formatDate(result.dates[tradingDays])} (${tradingDays.toLocaleString('en-IN')} trading days), ${withCosts ? 'after' : 'before'} charges.`}
    >
      <GrowthChart dates={result.dates} lines={lines} format={rupees} />

      <div className="scroll-area mt-4">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-xs whitespace-nowrap text-ink-400">
              <th className="py-2 pr-3 text-left font-medium">Strategy</th>
              <th className="py-2 pr-3 text-right font-medium">Final value</th>
              <th className="py-2 pr-3 text-right font-medium">Return</th>
              <th className="py-2 pr-3 text-right font-medium">Per year</th>
              <th className="py-2 pr-3 text-right font-medium">Trades</th>
              <th className="py-2 pr-3 text-right font-medium">Charges paid</th>
              <th className="py-2 pr-3 text-right font-medium" title="Share of trades that made money after charges">
                Winning trades
              </th>
              <th className="hidden py-2 text-right font-medium xl:table-cell">Worst fall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, color, series, strategy }) => (
              <tr key={label} className="border-t border-ink-800">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 border-t-2" style={{ borderColor: color }} />
                    {label}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">{rupees(series.final)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${tone(series.totalReturn)}`}>{signedPct(series.totalReturn)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${tone(series.annualReturn)}`}>{signedPct(series.annualReturn)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{strategy ? strategy.trades.toLocaleString('en-IN') : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{strategy ? rupees(strategy.charges) : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-400">
                  {strategy && strategy.trades ? formatPct(strategy.wins / strategy.trades) : '—'}
                </td>
                <td className="hidden py-2 text-right tabular-nums text-ink-400 xl:table-cell">{formatPct(-series.maxDrawdown)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-ink-400">
        {withCosts && result.overnight.trades > 0 && (
          <li>
            Average charges per round trip: {rupees(result.overnight.charges / result.overnight.trades)} overnight (including the ₹
            {CHARGES.dpChargePerSell} DP charge on every sell) and{' '}
            {result.intraday.trades ? rupees(result.intraday.charges / result.intraday.trades) : '—'} intraday.
          </li>
        )}
        {unaffordable > 0 && (
          <li className="text-orange-300">
            On {unaffordable.toLocaleString('en-IN')} days the money left couldn't buy even one share, so no trade was made.
          </li>
        )}
        {skipped > 0 && <li>{skipped} days with price jumps over 30% (usually unadjusted splits) were skipped.</li>}
      </ul>
    </Card>
  );
}

type SummaryRow = SymbolInfo & { holding: number | null; overnight: number | null; intraday: number | null; note: string | null };
type SortColumn = 'symbol' | 'holding' | 'overnight' | 'intraday';

type AllStocksProps = { settings: Settings; fetched: SymbolInfo[]; selected: string; onSelect: (symbol: string) => void };

function AllStocks({ settings, fetched, selected, onSelect }: AllStocksProps) {
  const summary = useAsync((signal) => loadSameDaySummary(signal), []);
  const [sort, setSort] = useState<{ column: SortColumn; descending: boolean }>({ column: 'overnight', descending: true });
  const { amount, period, withCosts } = settings;

  const builtIn = summary.status === 'ready' ? (summary.data?.stocks ?? []) : [];
  // Stocks fetched in this browser aren't in the daily summary, so they're tested here.
  const browserOnly = fetched.filter((s) => !s.symbol.startsWith('^') && !builtIn.some((b) => b.symbol === s.symbol));
  const histories = useHistories(browserOnly.map((s) => s.symbol));

  const rows = useMemo(() => {
    const key = summaryKey(amount, withCosts, period);
    // A strategy that never traded (one share costs more than the amount) has no result, rather than 0%.
    const traded = (value: number | undefined, trades: number | undefined) => (value == null || !trades ? null : value);
    const cantBuy = `${rupees(amount)} can't buy one share`;
    const list: SummaryRow[] = builtIn.map((s) => {
      const r = s.results[key];
      return {
        symbol: s.symbol,
        name: s.name,
        holding: r?.[0] ?? null,
        overnight: traded(r?.[1], r?.[3]),
        intraday: traded(r?.[2], r?.[4]),
        note: r && !r[3] && !r[4] ? cantBuy : null,
      };
    });
    for (const stock of browserOnly) {
      const loaded = histories[stock.symbol];
      if (loaded?.status === 'ready') {
        const r = sameDayTest(loaded.history, { amount, withCosts, days: daysFor(period) });
        list.push({
          ...stock,
          holding: r?.stock.totalReturn ?? null,
          overnight: traded(r?.overnight.totalReturn, r?.overnight.trades),
          intraday: traded(r?.intraday.totalReturn, r?.intraday.trades),
          note: r && !r.overnight.trades && !r.intraday.trades ? cantBuy : null,
        });
      } else {
        list.push({ ...stock, holding: null, overnight: null, intraday: null, note: loaded?.status === 'error' ? loaded.message : 'Loading…' });
      }
    }
    const direction = sort.descending ? -1 : 1;
    return list.sort((a, b) => {
      if (sort.column === 'symbol') return direction * displaySymbol(a.symbol).localeCompare(displaySymbol(b.symbol));
      const x = a[sort.column];
      const y = b[sort.column];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return direction * (x - y);
    });
  }, [builtIn, browserOnly, histories, amount, withCosts, period, sort]);

  const complete = rows.filter((r) => r.holding != null && r.overnight != null && r.intraday != null);
  const overnightBeatsIntraday = complete.filter((r) => r.overnight! > r.intraday!).length;
  const beatsHolding = complete.filter((r) => Math.max(r.overnight!, r.intraday!) > r.holding!).length;

  const header = (column: SortColumn, label: string, numeric = true) => (
    <th className={`py-2 pr-3 font-medium whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        className="hover:text-ink-200"
        onClick={() => setSort((s) => ({ column, descending: s.column === column ? !s.descending : column !== 'symbol' }))}
      >
        {label}
        {sort.column === column && <span className="ml-1">{sort.descending ? '↓' : '↑'}</span>}
      </button>
    </th>
  );

  return (
    <Card
      title="All stocks"
      subtitle={`Total return on ${rupees(amount)} over ${periodLabel(period)}, ${withCosts ? 'after' : 'before'} charges. Click a stock to chart it.`}
    >
      {summary.status === 'ready' && !summary.data && (
        <p className="mb-3 text-xs text-ink-500">
          The built-in stocks' table comes from the daily update. Running locally? Run <code>npm run same-day-test</code>.
        </p>
      )}
      {complete.length > 0 && (
        <p className="mb-3 text-sm text-ink-300">
          Overnight beat intraday for <strong>{overnightBeatsIntraday}</strong> of {complete.length} stocks. A same-day rule beat simply
          holding for <strong>{beatsHolding}</strong>.
        </p>
      )}
      {summary.status === 'loading' ? (
        <div className="h-48 animate-pulse rounded-lg bg-ink-800/40" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-400">No stocks to show.</p>
      ) : (
        <div className="scroll-area max-h-[60vh]">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 z-10 bg-ink-900">
              <tr className="text-xs text-ink-400">
                {header('symbol', 'Stock', false)}
                {header('holding', 'Holding')}
                {header('overnight', 'Close → next open')}
                {header('intraday', 'Open → close')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => {
                    onSelect(r.symbol);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  aria-selected={r.symbol === selected}
                  className={`cursor-pointer border-t border-ink-800 ${r.symbol === selected ? 'bg-accent-500/10' : 'hover:bg-ink-800/40'}`}
                >
                  <td className="py-2 pr-3">
                    <span className="block font-medium">{displaySymbol(r.symbol)}</span>
                    <span className="block max-w-56 truncate text-xs text-ink-400">{r.note ?? r.name}</span>
                  </td>
                  {[r.holding, r.overnight, r.intraday].map((value, n) => (
                    <td key={n} className={`py-2 pr-3 text-right tabular-nums ${tone(value)}`}>
                      {signedPct(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ChargesCard() {
  const pct = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.0001 ? 5 : 3).replace(/0+$/, '').replace(/\.$/, '')}%`;
  return (
    <Card title="How the test works" subtitle="Charges are a typical discount broker's (Zerodha's published rates). Full-service brokers charge more.">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
        <li>
          <strong className="text-ink-100">Buy at close, sell next open</strong> is a delivery trade (buy today, sell tomorrow): STT{' '}
          {pct(CHARGES.sttDelivery)} on both buy and sell, stamp duty {pct(CHARGES.stampDeliveryBuy)} on the buy, no brokerage, and a ₹
          {CHARGES.dpChargePerSell} DP charge on every sell.
        </li>
        <li>
          <strong className="text-ink-100">Buy at open, sell at close</strong> is an intraday trade: brokerage {pct(CHARGES.intradayBrokerageRate)}{' '}
          or ₹{CHARGES.intradayBrokerageCap} per order (whichever is lower), STT {pct(CHARGES.sttIntradaySell)} on the sell, stamp duty{' '}
          {pct(CHARGES.stampIntradayBuy)} on the buy.
        </li>
        <li>
          Both: NSE transaction charges {pct(CHARGES.exchangeRate)}, SEBI fees ₹10 per crore, and {pct(CHARGES.gstRate)} GST on brokerage,
          transaction and SEBI charges.
        </li>
        <li>
          Everything is reinvested each day in whole shares, at exactly the day's open or closing price. Real orders rarely fill exactly there,
          so results are a little better than you'd get. Income tax isn't included.
        </li>
        <li>
          Prices aren't adjusted for dividends, so holding and overnight are both slightly understated. Holiday placeholder rows and jumps over 30%
          (usually unadjusted splits) are skipped.
        </li>
      </ul>
    </Card>
  );
}
