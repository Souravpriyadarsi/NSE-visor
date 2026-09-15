import { useCallback, useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { GrowthChart, type GrowthLine } from '../components/GrowthChart.tsx';
import { IntradayChart } from '../components/IntradayChart.tsx';
import { PaperTrader } from '../components/PaperTrader.tsx';
import { StockPicker, type PickerOption } from '../components/StockPicker.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { useAsync, type AsyncState } from '../hooks/useAsync.ts';
import { useIntraday } from '../hooks/useIntraday.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { loadIntradayResearch } from '../lib/data/loadStatic.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct, formatPrice } from '../lib/format.ts';
import { completedSessions, istTime } from '../lib/intraday/bars.ts';
import {
  confidenceNote,
  MIN_SESSIONS,
  walkForward,
  type IntradayResearch,
  type TradeStats,
  type WalkForwardResult,
} from '../lib/intraday/evaluate.ts';
import { prepareBars } from '../lib/intraday/indicators.ts';
import { DEFAULT_RISK, RISK_PER_TRADE_CHOICES, riskLabel } from '../lib/intraday/risk.ts';
import { REASON_LABELS, type Trade } from '../lib/intraday/simulator.ts';
import { STRATEGIES, STRATEGY_SHORT_NAMES, strategyById, type StrategyId } from '../lib/intraday/strategies.ts';

type Props = { symbol: string; options: PickerOption[]; onSelectSymbol: (symbol: string) => void };

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');

export function DayTradingTab({ symbol, options, onSelectSymbol }: Props) {
  const research = useAsync((signal) => loadIntradayResearch(signal), []);
  const stockOptions = useMemo(() => options.filter((o) => !o.symbol.startsWith('^')), [options]);

  return (
    <div className="space-y-6">
      <StrategyLab symbol={symbol} options={stockOptions} onSelectSymbol={onSelectSymbol} />
      <ResearchTable
        research={research}
        selected={symbol}
        onSelect={(next) => {
          onSelectSymbol(next);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
      <PaperTrader options={stockOptions} research={research.status === 'ready' ? research.data : null} />
    </div>
  );
}

function MoneyCell({ stats }: { stats: TradeStats }) {
  return (
    <td className={`py-2 pr-3 text-right tabular-nums ${tone(stats.net)}`}>
      <span className="block font-medium">{signedRupees(stats.net)}</span>
      <span className="block text-[11px] opacity-80">{formatPct(stats.netPct, true)}</span>
    </td>
  );
}

function Verdict({ pass, reasons }: { pass: boolean; reasons: string[] }) {
  return (
    <span
      title={pass ? 'Made money on the unseen days with enough trades' : reasons.join('\n')}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${pass ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}
    >
      {pass ? 'Passes' : 'Fails'}
    </span>
  );
}

function StrategyLab({ symbol, options, onSelectSymbol }: Props) {
  const [riskPerTrade, setRiskPerTrade] = useState(DEFAULT_RISK.riskPerTrade);
  const [allowShort, setAllowShort] = useState(true);
  const [picked, setPicked] = useState<StrategyId | null>(null);
  const [day, setDay] = useState<{ symbol: string; index: number } | null>(null);

  const isIndex = symbol.startsWith('^');
  const loaded = useIntraday(isIndex ? [] : [symbol], '60d', false)[symbol];
  const history = loaded?.status === 'ready' ? loaded.history : null;
  const data = useMemo(() => (history ? prepareBars({ ...history, sessions: completedSessions(history) }) : null), [history]);
  const risk = useMemo(() => ({ ...DEFAULT_RISK, riskPerTrade, allowShort }), [riskPerTrade, allowShort]);
  const results = useMemo(
    () => (data ? STRATEGIES.map((s) => walkForward(data, s, risk)).filter((r): r is WalkForwardResult => r != null) : []),
    [data, risk],
  );
  const selected = results.find((r) => r.strategy === picked) ?? results.find((r) => r.pass) ?? results[0] ?? null;
  const format = useCallback((value: number) => formatPrice(value, symbol), [symbol]);

  const dates = useMemo(() => selected?.days.map((d) => d.date) ?? [], [selected]);
  const lines = useMemo<GrowthLine[]>(() => {
    if (!selected) return [];
    let capital = risk.capital;
    return [{ label: `Capital trading ${strategyById(selected.strategy).name}`, color: CHART_COLORS.forecast, values: selected.days.map((d) => (capital += d.net)) }];
  }, [selected, risk.capital]);

  const sessionCount = data?.sessions.length ?? 0;
  const dayIndex = day?.symbol === symbol ? Math.min(day.index, sessionCount - 1) : sessionCount - 1;
  const session = data && dayIndex >= 0 ? data.sessions[dayIndex] : null;
  const dayTrades: Trade[] = selected && session ? [...selected.trainTrades, ...selected.testTrades].filter((t) => t.date === session.date) : [];
  const vwap = useMemo(
    () => (data && dayIndex >= 0 ? data.vwap.slice(data.sessionStart[dayIndex], data.sessionStart[dayIndex + 1]) : undefined),
    [data, dayIndex],
  );

  let body;
  if (isIndex) {
    body = <p className="mt-4 text-sm text-ink-400">Indices can't be traded directly. Pick a stock above.</p>;
  } else if (!loaded || loaded.status === 'loading') {
    body = <div className="mt-4 h-72 animate-pulse rounded-lg bg-ink-800/40" />;
  } else if (loaded.status === 'error') {
    body = <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{loaded.message}</p>;
  } else if (!data || !selected) {
    body = (
      <p className="mt-4 text-sm text-ink-400">
        Only {sessionCount} trading days of 5-minute prices for {displaySymbol(symbol)}; the test needs {MIN_SESSIONS}.
      </p>
    );
  } else {
    const strategy = strategyById(selected.strategy);
    const { test } = selected;
    body = (
      <>
        <p className="mt-4 text-sm text-ink-300">
          <span className="font-medium text-ink-100">{displaySymbol(symbol)}</span> · {sessionCount} trading days from {formatDate(data.sessions[0].date)} to{' '}
          {formatDate(data.sessions[sessionCount - 1].date)}. Settings are chosen on the days before {formatDate(selected.testFrom)}; the rest are unseen.
        </p>
        <div className="scroll-area mt-3">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-xs whitespace-nowrap text-ink-400">
                <th className="py-2 pr-3 text-left font-medium">Strategy</th>
                <th className="py-2 pr-3 text-right font-medium" title="The days used to choose the settings">
                  Choosing days
                </th>
                <th className="py-2 pr-3 text-right font-medium" title="Days that played no part in choosing the settings">
                  Unseen days
                </th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                <th className="py-2 pr-3 text-right font-medium">Win rate</th>
                <th className="py-2 pr-3 text-right font-medium" title="Money made on winners ÷ money lost on losers">
                  Profit factor
                </th>
                <th className="py-2 pr-3 text-left font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.strategy}
                  onClick={() => setPicked(r.strategy)}
                  className={`cursor-pointer border-t border-ink-800 hover:bg-ink-800/40 ${r === selected ? 'bg-accent-500/10' : ''}`}
                >
                  <td className="py-2 pr-3">
                    <button type="button" className="rounded text-left focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none">
                      <span className="block font-medium text-ink-100">{strategyById(r.strategy).name}</span>
                      <span className="block text-xs text-ink-400">{strategyById(r.strategy).describe(r.params)}</span>
                    </button>
                  </td>
                  <MoneyCell stats={r.train} />
                  <MoneyCell stats={r.test} />
                  <td className="py-2 pr-3 text-right tabular-nums">{r.test.trades}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.test.winRate == null ? '—' : formatPct(r.test.winRate)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.test.profitFactor == null ? '—' : r.test.profitFactor.toFixed(2)}</td>
                  <td className="py-2 pr-3">
                    <Verdict pass={r.pass} reasons={r.reasons} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 space-y-4 border-t border-ink-800 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">{strategy.name}</h3>
            <p className="mt-0.5 text-xs text-ink-400">
              {strategy.description} Settings used: {strategy.describe(selected.params)}.
            </p>
          </div>
          <p className="text-sm text-ink-300">
            On the {test.sessions} unseen days: {test.trades} trades, <span className={tone(test.net)}>{signedRupees(test.net)}</span> after{' '}
            {rupees(test.charges)} of charges, {test.wins} winners, worst fall {formatPct(test.maxDrawdown)}. {confidenceNote(test)}
          </p>
          {!selected.pass && (
            <ul className="space-y-0.5 text-xs text-orange-300">
              {selected.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <GrowthChart dates={dates} lines={lines} format={rupees} />

          {session && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous day"
                  disabled={dayIndex <= 0}
                  onClick={() => setDay({ symbol, index: dayIndex - 1 })}
                  className="rounded-lg border border-ink-700 px-2.5 py-1 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-30"
                >
                  ‹
                </button>
                <span className="min-w-28 text-center text-sm text-ink-100">{formatDate(session.date)}</span>
                <button
                  type="button"
                  aria-label="Next day"
                  disabled={dayIndex >= sessionCount - 1}
                  onClick={() => setDay({ symbol, index: dayIndex + 1 })}
                  className="rounded-lg border border-ink-700 px-2.5 py-1 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-30"
                >
                  ›
                </button>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${session.date >= selected.testFrom ? 'bg-accent-500/15 text-accent-300' : 'bg-ink-800 text-ink-400'}`}>
                  {session.date >= selected.testFrom ? 'Unseen day' : 'Choosing day'}
                </span>
                <span className="text-xs text-ink-500">Arrows: entries · circles: exits · dashed line: VWAP</span>
              </div>
              <div className="mt-3">
                <IntradayChart bars={session.bars} vwap={vwap} trades={dayTrades} format={format} />
              </div>
              {dayTrades.length === 0 ? (
                <p className="mt-2 text-sm text-ink-400">No trades on this day.</p>
              ) : (
                <div className="scroll-area mt-3">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="text-xs text-ink-400">
                        <th className="py-2 pr-3 text-left font-medium">Time</th>
                        <th className="py-2 pr-3 text-left font-medium">Side</th>
                        <th className="py-2 pr-3 text-right font-medium">Shares</th>
                        <th className="py-2 pr-3 text-right font-medium">Entry</th>
                        <th className="py-2 pr-3 text-right font-medium">Exit</th>
                        <th className="py-2 pr-3 text-left font-medium">Exit reason</th>
                        <th className="py-2 pr-3 text-right font-medium">Charges</th>
                        <th className="py-2 pr-3 text-right font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayTrades.map((t) => (
                        <tr key={t.entryTime} className="border-t border-ink-800">
                          <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-ink-400">
                            {istTime(t.entryTime)}–{istTime(t.exitTime)}
                          </td>
                          <td className="py-2 pr-3">{t.side === 1 ? 'Long' : 'Short'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{t.qty}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{format(t.entryPrice)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{format(t.exitPrice)}</td>
                          <td className="py-2 pr-3 text-ink-400">{REASON_LABELS[t.reason]}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(t.charges)}</td>
                          <td className={`py-2 pr-3 text-right font-medium tabular-nums ${tone(t.net)}`}>{signedRupees(t.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <Card
      title="Strategy lab"
      subtitle="Tests each strategy on about 60 trading days of 5-minute prices, after Zerodha intraday charges and slippage. Settings are chosen on the first two-thirds of the days; the last third played no part in that choice, so it's the honest test."
    >
      <div className="flex flex-wrap items-center gap-3">
        <StockPicker options={options} onSelect={onSelectSymbol} placeholder="Pick a stock to test" />
        <Toggle
          label="Direction"
          value={allowShort ? 'both' : 'long'}
          choices={[
            { value: 'both', label: 'Long and short' },
            { value: 'long', label: 'Long only' },
          ]}
          onChange={(choice) => setAllowShort(choice === 'both')}
        />
        <Toggle
          label="Risk per trade"
          value={riskPerTrade}
          choices={RISK_PER_TRADE_CHOICES.map((r) => ({ value: r, label: `Risk ${riskLabel(r)}` }))}
          onChange={setRiskPerTrade}
        />
      </div>
      <p className="mt-2 text-xs text-ink-500">
        {rupees(risk.capital)} capital with no leverage, up to {risk.maxTradesPerDay} trades a day, done for the day after a {formatPct(risk.dailyLossLimit)} loss,
        no new trades after 14:45, everything closed by 15:15, and {riskLabel(risk.slippage)} slippage on each order.
      </p>
      {body}
    </Card>
  );
}

type ResearchTableProps = { research: AsyncState<IntradayResearch | null>; selected: string; onSelect: (symbol: string) => void };

function ResearchTable({ research, selected, onSelect }: ResearchTableProps) {
  const [onlyPassing, setOnlyPassing] = useState(false);
  const data = research.status === 'ready' ? research.data : null;
  const stocks = data?.stocks ?? [];
  const best = (s: IntradayResearch['stocks'][number]) => Math.max(...STRATEGIES.map((st) => s.results[st.id]?.test.netPct ?? -Infinity));
  const rows = stocks.filter((s) => !onlyPassing || STRATEGIES.some((st) => s.results[st.id]?.pass)).sort((a, b) => best(b) - best(a));
  const sample = stocks.find((s) => s.testFrom);

  return (
    <Card
      title="All NIFTY 50 stocks"
      subtitle="The same test for every NIFTY 50 stock, rerun after each day's close with ₹1,00,000 capital and 0.5% risk per trade. Each cell is the profit or loss on the unseen days after charges. Click a stock to open it in the lab."
    >
      {research.status === 'loading' ? (
        <div className="h-48 animate-pulse rounded-lg bg-ink-800/40" />
      ) : !data ? (
        <p className="text-sm text-ink-400">
          This table comes from the daily update. Running locally? Run <code>npm run intraday-research</code>.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              label="Filter"
              value={onlyPassing ? 'pass' : 'all'}
              choices={[
                { value: 'all', label: 'All stocks' },
                { value: 'pass', label: 'Only passing' },
              ]}
              onChange={(choice) => setOnlyPassing(choice === 'pass')}
            />
            {sample && (
              <span className="text-xs text-ink-400">
                {sample.sessions} trading days to {formatDate(sample.lastDate)}, unseen from {formatDate(sample.testFrom!)} · updated{' '}
                {formatDate(data.generatedAt.slice(0, 10))}
              </span>
            )}
          </div>
          <p className="mt-3 text-sm text-ink-300">
            Passed:{' '}
            {STRATEGIES.map((st) => `${STRATEGY_SHORT_NAMES[st.id]} ${stocks.filter((s) => s.results[st.id]?.pass).length} of ${stocks.length}`).join(' · ')}
          </p>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-ink-400">No stock passed with any strategy.</p>
          ) : (
            <div className="scroll-area mt-3 max-h-[60vh]">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="sticky top-0 z-10 bg-ink-900">
                  <tr className="text-xs text-ink-400">
                    <th className="py-2 pr-3 text-left font-medium">Stock</th>
                    {STRATEGIES.map((st) => (
                      <th key={st.id} className="py-2 pr-3 text-right font-medium" title={st.description}>
                        {STRATEGY_SHORT_NAMES[st.id]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.symbol}
                      onClick={() => onSelect(s.symbol)}
                      className={`cursor-pointer border-t border-ink-800 hover:bg-ink-800/40 ${s.symbol === selected ? 'bg-accent-500/10' : ''}`}
                    >
                      <td className="py-2 pr-3">
                        <span className="block font-medium text-ink-100">{displaySymbol(s.symbol)}</span>
                        <span className="block max-w-48 truncate text-xs text-ink-400">{s.name}</span>
                      </td>
                      {STRATEGIES.map((st) => {
                        const r = s.results[st.id];
                        return (
                          <td key={st.id} className={`py-2 pr-3 text-right tabular-nums ${tone(r?.test.net)}`}>
                            {r ? (
                              <>
                                <span className="block font-medium">
                                  {formatPct(r.test.netPct, true)}
                                  {r.pass && <span className="ml-1.5 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-300">pass</span>}
                                </span>
                                <span className="block text-[11px] text-ink-500">{r.test.trades} trades</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
