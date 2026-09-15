import { useMemo } from 'react';
import { Card } from './Card.tsx';
import { useIntraday } from '../hooks/useIntraday.ts';
import { displaySymbol } from '../lib/data/symbols.ts';
import { formatDate } from '../lib/dates.ts';
import { completedSessions } from '../lib/intraday/bars.ts';
import { prepareBars } from '../lib/intraday/indicators.ts';
import { DEFAULT_RISK, riskLabel, type RiskLimits } from '../lib/intraday/risk.ts';
import { simulate, type Trade } from '../lib/intraday/simulator.ts';
import { SCALP, type StrategyParams } from '../lib/intraday/strategies.ts';

/** Scalping means many trades a day, so the daily trade cap is lifted; every other limit is the same. */
const SCALP_RISK: RiskLimits = { ...DEFAULT_RISK, maxTradesPerDay: 100 };

type Totals = {
  trades: number;
  /** Trades whose price move was in their favour before any costs. */
  moveWins: number;
  /** Profit or loss from price moves alone, before slippage and charges. */
  move: number;
  slippage: number;
  charges: number;
  net: number;
  avgMove: number | null;
  avgCosts: number | null;
};

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const tone = (value: number) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
/** Small percentages need three decimals: "0.083%". */
const smallPct = (fraction: number | null, signed = false) =>
  fraction == null ? '—' : `${signed && fraction > 0 ? '+' : ''}${(fraction * 100).toFixed(3)}%`;

function totals(trades: Trade[]): Totals {
  const sum = (pick: (t: Trade) => number) => trades.reduce((total, t) => total + pick(t), 0);
  const value = (t: Trade) => t.qty * t.entryPrice;
  const n = trades.length;
  return {
    trades: n,
    moveWins: trades.filter((t) => t.gross + t.slippage > 0).length,
    move: sum((t) => t.gross + t.slippage),
    slippage: sum((t) => t.slippage),
    charges: sum((t) => t.charges),
    net: sum((t) => t.net),
    avgMove: n ? sum((t) => (t.gross + t.slippage) / value(t)) / n : null,
    avgCosts: n ? sum((t) => (t.slippage + t.charges) / value(t)) / n : null,
  };
}

/** Fast in-and-out trades on 1-minute prices, with price moves, slippage and charges shown separately. */
export function ScalpTest({ symbol }: { symbol: string }) {
  const isIndex = symbol.startsWith('^');
  const loaded = useIntraday(isIndex ? [] : [symbol], '5d', false, '1m')[symbol];
  const history = loaded?.status === 'ready' ? loaded.history : null;

  const runs = useMemo(() => {
    if (!history) return null;
    const data = prepareBars({ ...history, sessions: completedSessions(history) });
    if (data.sessions.length === 0) return { sessions: 0, rows: [] as { params: StrategyParams; trades: Trade[]; totals: Totals }[] };
    return {
      sessions: data.sessions.length,
      rows: SCALP.grid.map((params) => {
        const { trades } = simulate(data, SCALP, params, SCALP_RISK);
        return { params, trades, totals: totals(trades) };
      }),
    };
  }, [history]);

  const main = runs?.rows.find((r) => r.params.atrStop === 1) ?? runs?.rows[0];
  const byDay = main
    ? [...new Set(main.trades.map((t) => t.date))].map((date) => ({ date, ...totals(main.trades.filter((t) => t.date === date)) }))
    : [];

  let body;
  if (isIndex) {
    body = <p className="text-sm text-ink-400">Indices can't be traded directly. Pick a stock in the lab above.</p>;
  } else if (!loaded || loaded.status === 'loading') {
    body = <div className="h-48 animate-pulse rounded-lg bg-ink-800/40" />;
  } else if (loaded.status === 'error') {
    body = <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{loaded.message}</p>;
  } else if (!runs || !main) {
    body = <p className="text-sm text-ink-400">No finished trading days of 1-minute prices for {displaySymbol(symbol)} yet.</p>;
  } else {
    const t = main.totals;
    body = (
      <>
        <p className="text-sm text-ink-300">
          <span className="font-medium text-ink-100">{displaySymbol(symbol)}</span>, last {runs.sessions} trading days, with a 1× ATR stop: {t.trades} trades.
          The price moves alone made <span className={tone(t.move)}>{signedRupees(t.move)}</span>
          {t.trades > 0 && ` (${smallPct(t.avgMove, true)} a trade)`}. Slippage cost {rupees(t.slippage)} and charges {rupees(t.charges)}, leaving{' '}
          <span className={`font-semibold ${tone(t.net)}`}>{signedRupees(t.net)}</span>
          {t.trades > 0 && ` (costs averaged ${smallPct(t.avgCosts)} a trade)`}.
        </p>

        <div className="scroll-area mt-4">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs whitespace-nowrap text-ink-400">
                <th className="py-2 pr-3 text-left font-medium">Stop-loss</th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                <th className="py-2 pr-3 text-right font-medium" title="Share of trades whose price moved their way, before any costs">
                  Moved their way
                </th>
                <th className="py-2 pr-3 text-right font-medium" title="Profit or loss from price moves, before slippage and charges">
                  Price moves
                </th>
                <th className="py-2 pr-3 text-right font-medium">Slippage</th>
                <th className="py-2 pr-3 text-right font-medium">Charges</th>
                <th className="py-2 pr-3 text-right font-medium">After costs</th>
                <th className="py-2 pr-3 text-right font-medium" title="Average price move per trade, as a share of the position">
                  Avg move
                </th>
                <th className="py-2 pr-3 text-right font-medium" title="Average slippage plus charges per trade, as a share of the position">
                  Avg costs
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.rows.map(({ params, totals: r }) => (
                <tr key={params.atrStop} className={`border-t border-ink-800 ${params === main.params ? 'bg-accent-500/10' : ''}`}>
                  <td className="py-2 pr-3">{params.atrStop}× ATR</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.trades}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.trades ? `${Math.round((r.moveWins / r.trades) * 100)}%` : '—'}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(r.move)}`}>{signedRupees(r.move)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(r.slippage)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(r.charges)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${tone(r.net)}`}>{signedRupees(r.net)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${tone(r.avgMove ?? 0)}`}>{smallPct(r.avgMove, true)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{smallPct(r.avgCosts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {byDay.length > 0 && (
          <div className="scroll-area mt-4">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-xs text-ink-400">
                  <th className="py-2 pr-3 text-left font-medium">Day (1× ATR stop)</th>
                  <th className="py-2 pr-3 text-right font-medium">Trades</th>
                  <th className="py-2 pr-3 text-right font-medium">Price moves</th>
                  <th className="py-2 pr-3 text-right font-medium">Slippage + charges</th>
                  <th className="py-2 pr-3 text-right font-medium">After costs</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date} className="border-t border-ink-800">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{d.trades}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${tone(d.move)}`}>{signedRupees(d.move)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{rupees(d.slippage + d.charges)}</td>
                    <td className={`py-2 pr-3 text-right font-medium tabular-nums ${tone(d.net)}`}>{signedRupees(d.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-ink-500">
          Yahoo keeps only about a week of 1-minute prices, so this is a small sample: it shows the arithmetic of fast trading rather than proving
          anything about the rule. Slippage is {riskLabel(SCALP_RISK.slippage)} per market order (targets fill exactly); real scalping would also cross the
          bid-ask spread.
        </p>
      </>
    );
  }

  return (
    <Card
      title="Scalping test (1-minute prices)"
      subtitle={`${SCALP.description} Up to ₹1,00,000 per trade and up to 100 trades a day, with the same daily loss limit and 15:15 close. Price moves, slippage and Zerodha intraday charges are shown separately.`}
    >
      {body}
    </Card>
  );
}
