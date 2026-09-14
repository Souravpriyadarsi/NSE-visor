import { useMemo, useState } from 'react';
import { Card } from '../components/Card.tsx';
import { GrowthChart, type GrowthLine } from '../components/GrowthChart.tsx';
import { SignalStatusBadge } from '../components/SignalStatusBadge.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { loadResearchReport } from '../lib/data/loadStatic.ts';
import { formatDate } from '../lib/dates.ts';
import { formatPct } from '../lib/format.ts';
import { RANGE_METHOD, RANGE_SCALE } from '../lib/models/ensemble.ts';
import type { ForecastKey, ForecastSummary, ModelAccuracy } from '../lib/research/forecastStudy.ts';
import type { PeriodResult, RegimeExcess, SignalSummary } from '../lib/research/rankingStudy.ts';
import type { ResearchReport } from '../lib/research/research.ts';
import type { RankKey } from '../lib/research/signals.ts';

const MODEL_LABELS: Record<ForecastKey, string> = {
  ensemble: 'Blended forecast',
  trend: 'Trend line',
  holt: 'Holt smoothing',
  gbm: 'Random-walk simulation',
  baseline: 'No change (direction: always up)',
};

const pct = (value: number | null | undefined, signed = false) => (value == null || !Number.isFinite(value) ? '—' : formatPct(value, signed));
const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');
const coverageTone = (value: number | null | undefined) => (value == null ? '' : Math.abs(value - 0.8) <= 0.05 ? 'text-emerald-400' : 'text-orange-300');
const excessOf = (p: PeriodResult | null) => (p ? p.cagr - p.universeCagr : null);
const modelOf = (summary: ForecastSummary | null, key: ForecastKey) => summary?.models.find((m) => m.key === key) ?? null;

const TH = 'py-2 pr-3 font-medium whitespace-nowrap';
const TD = 'py-2 pr-3 tabular-nums';

export function ReportTab() {
  const report = useAsync((signal) => loadResearchReport(signal), []);

  if (report.status === 'loading') return <div className="h-64 animate-pulse rounded-xl bg-ink-900" />;
  if (report.status === 'error') return <p className="text-sm text-rose-300">{report.message}</p>;
  if (!report.data) {
    return (
      <Card title="No report yet" subtitle="The daily update builds it after downloading prices.">
        <p className="text-sm text-ink-300">
          Running locally? Run <code>npm run fetch-data</code> and then <code>npm run research</code>.
        </p>
      </Card>
    );
  }
  return <Report report={report.data} />;
}

function Report({ report }: { report: ResearchReport }) {
  // Start on the signal the Dashboard ranks by: the confirmed signal with the strongest development result.
  const [selected, setSelected] = useState<RankKey>(
    () =>
      report.ranking.signals.filter((s) => s.status === 'confirmed').sort((a, b) => (b.dev?.icT ?? 0) - (a.dev?.icT ?? 0))[0]?.key ??
      'composite',
  );
  const { forecasts, ranking, period, universe } = report;
  const signal = ranking.signals.find((s) => s.key === selected) ?? ranking.signals[0];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-400">
        {universe.stocks} {universe.name} stocks, tested every month-end from {formatDate(period.from)} to {formatDate(period.to)}.
        Outcomes after <strong className="text-ink-200">{formatDate(period.holdoutStart)}</strong> form the sealed test period. Updated{' '}
        {formatDate(report.generatedAt.slice(0, 10))}.
      </p>
      <Verdicts report={report} />
      <ForecastCard dev={forecasts.dev} holdout={forecasts.holdout} />
      <RangeCard report={report} />
      <SignalsCard report={report} selected={signal.key} onSelect={setSelected} />
      {signal && <PortfolioCard report={report} signal={signal} />}
      <RegimeCard report={report} />
      <YearCard report={report} />
      <MethodCard report={report} />
    </div>
  );
}

function Verdicts({ report }: { report: ResearchReport }) {
  const test = report.forecasts.holdout;
  const blend = modelOf(test, 'ensemble');
  const baseline = modelOf(test, 'baseline');
  const relative = blend && baseline ? blend.error / baseline.error - 1 : null;
  const usualRate = test ? Math.max(test.upRate, 1 - test.upRate) : null;
  const best = report.ranking.signals
    .filter((s) => s.status === 'confirmed')
    .sort((a, b) => (excessOf(b.holdout) ?? 0) - (excessOf(a.holdout) ?? 0))[0];

  const cards = [
    {
      label: 'Price forecast vs "no change"',
      value: relative == null ? '—' : relative <= -0.03 ? `${pct(-relative)} better` : relative >= 0.03 ? `${pct(relative)} worse` : 'About the same',
      className: relative == null ? '' : relative <= -0.03 ? 'text-emerald-400' : relative >= 0.03 ? 'text-rose-400' : '',
      hint: blend && baseline ? `Error ${pct(blend.error)} vs ${pct(baseline.error)} in the sealed test` : 'No sealed test results',
    },
    {
      label: 'Up/down calls right',
      value: pct(blend?.hitRate),
      className: blend && usualRate != null && blend.ci[0] > usualRate ? 'text-emerald-400' : '',
      hint: blend && test ? `95% range ${pct(blend.ci[0])}–${pct(blend.ci[1])}; prices rose ${pct(test.upRate)} of the time` : '',
    },
    {
      label: '80% range held',
      value: pct(test?.coverageCalibrated),
      className: coverageTone(test?.coverageCalibrated),
      hint: 'Sealed test; ideal is about 80%',
    },
    {
      label: 'Best confirmed ranking',
      value: best ? `${pct(excessOf(best.holdout), true)} a year` : 'None confirmed',
      className: best ? tone(excessOf(best.holdout)) : 'text-orange-300',
      hint: best ? `${best.label}: top 20% vs the average stock, after costs` : 'No signal passed both the development and sealed tests',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
          <p className="text-xs text-ink-400">{c.label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${c.className}`}>{c.value}</p>
          <p className="mt-0.5 text-[11px] text-ink-500">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

function AccuracyCells({ model }: { model: ModelAccuracy | null }) {
  return (
    <>
      <td className={`${TD} text-right`}>{pct(model?.error)}</td>
      <td className={`${TD} text-right`}>
        {pct(model?.hitRate)}
        {model && (
          <span className="block text-[11px] text-ink-500">
            {pct(model.ci[0])}–{pct(model.ci[1])}
          </span>
        )}
      </td>
    </>
  );
}

function ForecastCard({ dev, holdout }: { dev: ForecastSummary | null; holdout: ForecastSummary | null }) {
  const keys = (dev ?? holdout)?.models.map((m) => m.key) ?? [];
  return (
    <Card
      title="1-month price forecasts"
      subtitle="At every month-end, each stock was forecast 22 trading days ahead using only data up to that day, then compared with the actual price."
    >
      <div className="scroll-area">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Model</th>
              <th className={`${TH} text-right`}>Error (development)</th>
              <th className={`${TH} text-right`}>Direction right</th>
              <th className={`${TH} text-right`}>Error (sealed test)</th>
              <th className={`${TH} text-right`}>Direction right</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key} className={`border-t border-ink-800 ${key === 'ensemble' ? 'font-semibold' : 'text-ink-300'}`}>
                <td className="py-2 pr-3">{MODEL_LABELS[key]}</td>
                <AccuracyCells model={modelOf(dev, key)} />
                <AccuracyCells model={modelOf(holdout, key)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-ink-400">
        <li>
          Small grey figures are 95% confidence ranges. Prices rose in {pct(dev?.upRate)} (development) and {pct(holdout?.upRate)} (sealed
          test) of cases, so a direction score only shows skill if its whole range sits above the more common outcome.
        </li>
        <li>
          The blend beat "no change" for {dev?.stocksBeatingBaseline ?? '—'} of {dev?.stocks ?? '—'} stocks in development and{' '}
          {holdout?.stocksBeatingBaseline ?? '—'} of {holdout?.stocks ?? '—'} in the sealed test.
        </li>
        <li>
          "Chance of ending higher" scored {dev?.brier.toFixed(3) ?? '—'} (development) and {holdout?.brier.toFixed(3) ?? '—'} (sealed test),
          against {dev?.brierBaseRate.toFixed(3) ?? '—'} and {holdout?.brierBaseRate.toFixed(3) ?? '—'} for always saying the usual rate.
          Lower is better.
        </li>
      </ul>
    </Card>
  );
}

function RangeCard({ report }: { report: ResearchReport }) {
  const { dev, holdout, rangeScale } = report.forecasts;
  const rows = [
    { label: 'Classic: 1-year volatility, bell curve', dev: dev?.coverageClassic, test: holdout?.coverageClassic },
    { label: 'Adaptive: recent volatility, real move shapes', dev: dev?.coverageAdaptive, test: holdout?.coverageAdaptive },
    { label: `Adaptive, width × ${rangeScale.toFixed(2)} (fitted on development years)`, dev: dev?.coverageCalibrated, test: holdout?.coverageCalibrated },
  ];
  return (
    <Card title="Likely range (80%)" subtitle="How often the actual price 1 month later landed inside the range. Ideal is about 80%.">
      <div className="scroll-area">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Method</th>
              <th className={`${TH} text-right`}>Held (development)</th>
              <th className={`${TH} text-right`}>Held (sealed test)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-ink-800">
                <td className="py-2 pr-3 text-ink-300">{r.label}</td>
                <td className={`${TD} text-right ${coverageTone(r.dev)}`}>{pct(r.dev)}</td>
                <td className={`${TD} text-right ${coverageTone(r.test)}`}>{pct(r.test)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        The app's ranges currently use the {RANGE_METHOD} method with width × {RANGE_SCALE.toFixed(2)}.
      </p>
    </Card>
  );
}

type SignalsProps = { report: ResearchReport; selected: RankKey; onSelect: (key: RankKey) => void };

function SignalsCard({ report, selected, onSelect }: SignalsProps) {
  const { settings } = report;
  return (
    <Card
      title="Stock rankings"
      subtitle={`At each month-end, stocks were ranked using only data up to that day. The top ${pct(settings.topShare)} were "bought" in equal amounts for a month, less ${pct(settings.costRoundTrip)} per round trip. Click a row to chart it.`}
    >
      <div className="scroll-area">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Signal</th>
              <th className={`${TH} text-left`}>Result</th>
              <th className={`${TH} text-right`} title="Average monthly rank correlation with next month's returns (development)">
                Rank correlation
              </th>
              <th className={`${TH} hidden text-right xl:table-cell`}>Months positive</th>
              <th className={`${TH} text-right`} title="Top 20% after costs minus the average stock, per year">
                vs average (dev.)
              </th>
              <th className={`${TH} text-right`}>vs average (test)</th>
              <th className={`${TH} text-right`}>vs NIFTY 50 (test)</th>
            </tr>
          </thead>
          <tbody>
            {report.ranking.signals.map((s) => {
              const testVsNifty = s.holdout && s.holdout.niftyCagr != null ? s.holdout.cagr - s.holdout.niftyCagr : null;
              return (
                <tr
                  key={s.key}
                  onClick={() => onSelect(s.key)}
                  aria-selected={s.key === selected}
                  className={`cursor-pointer border-t border-ink-800 ${s.key === selected ? 'bg-accent-500/10' : 'hover:bg-ink-800/40'}`}
                >
                  <td className="py-2 pr-3">
                    <span className="block font-medium">{s.label}</span>
                    <span className="block max-w-52 text-xs text-ink-400">{s.description}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <SignalStatusBadge status={s.status} />
                  </td>
                  <td className={`${TD} text-right`}>
                    {s.dev ? s.dev.meanIc.toFixed(3) : '—'}
                    {s.dev && <span className="block text-[11px] text-ink-500">t = {s.dev.icT.toFixed(1)}</span>}
                  </td>
                  <td className={`${TD} hidden text-right xl:table-cell`}>{pct(s.dev?.positiveShare)}</td>
                  <td className={`${TD} text-right ${tone(excessOf(s.dev))}`}>{pct(excessOf(s.dev), true)}</td>
                  <td className={`${TD} text-right ${tone(excessOf(s.holdout))}`}>{pct(excessOf(s.holdout), true)}</td>
                  <td className={`${TD} text-right ${tone(testVsNifty)}`}>{pct(testVsNifty, true)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        Rank correlation measures how well each month's ranking lined up with the next month's returns: 0 is random, and around 0.03–0.05 is
        typical of signals that work. A t of 2 or more means the average is unlikely to be luck.
      </p>
    </Card>
  );
}

function PortfolioCard({ report, signal }: { report: ResearchReport; signal: SignalSummary }) {
  const { curve } = report.ranking;
  const lines = useMemo<GrowthLine[]>(
    () => [
      { label: `${signal.label}: top 20% after costs`, color: CHART_COLORS.forecast, values: curve.series[signal.key] },
      { label: 'Average stock', color: CHART_COLORS.price, values: curve.universe },
      { label: 'NIFTY 50 (without dividends)', color: CHART_COLORS.sma50, values: curve.nifty },
    ],
    [curve, signal],
  );

  const rows: { label: string; value: (p: PeriodResult) => number | null; signed?: boolean; plain?: (p: PeriodResult) => string }[] = [
    { label: 'Return a year', value: (p) => p.cagr },
    { label: 'vs average stock', value: (p) => p.cagr - p.universeCagr, signed: true },
    { label: 'vs NIFTY 50', value: (p) => (p.niftyCagr == null ? null : p.cagr - p.niftyCagr), signed: true },
    { label: 'Volatility a year', value: (p) => p.volatility },
    { label: 'Sharpe ratio', value: () => null, plain: (p) => p.sharpe.toFixed(2) },
    { label: 'Worst fall', value: (p) => -p.maxDrawdown, signed: true },
    { label: 'Months beating the average stock', value: (p) => p.beatUniverseShare },
    { label: 'Share of holdings replaced each month', value: (p) => p.turnover },
  ];

  return (
    <Card
      title={`Growth of ₹1: ${signal.label}`}
      subtitle={`Rebalanced monthly. The sealed test period starts ${formatDate(report.period.holdoutStart)}.`}
    >
      {curve.dates.length > 1 ? <GrowthChart dates={curve.dates} lines={lines} /> : <p className="text-sm text-ink-400">Not enough months to chart.</p>}
      <div className="scroll-area mt-4">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Top 20%, after costs</th>
              <th className={`${TH} text-right`}>Development</th>
              <th className={`${TH} text-right`}>Sealed test</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-ink-800">
                <td className="py-2 pr-3 text-ink-300">{row.label}</td>
                {[signal.dev, signal.holdout].map((p, n) => (
                  <td key={n} className={`${TD} text-right ${row.signed && p ? tone(row.value(p)) : ''}`}>
                    {!p ? '—' : row.plain ? row.plain(p) : pct(row.value(p), row.signed)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RegimeCard({ report }: { report: ResearchReport }) {
  const { bull, bear } = report.forecasts.byRegime;
  const cell = (r: RegimeExcess) => (
    <td className={`${TD} text-right`}>
      <span className={tone(r.excess)}>{r.excess == null ? '—' : `${pct(r.excess, true)}`}</span>
      <span className="block text-[11px] text-ink-500">{r.months} months</span>
    </td>
  );
  return (
    <Card
      title="Market conditions"
      subtitle="Top 20% after costs minus the average stock, per month, split by the market's state at each month-end."
    >
      <div className="scroll-area">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Signal</th>
              <th className={`${TH} text-right`}>NIFTY above 200-day avg</th>
              <th className={`${TH} text-right`}>NIFTY below</th>
              <th className={`${TH} text-right`}>India VIX calmer</th>
              <th className={`${TH} text-right`}>India VIX higher</th>
            </tr>
          </thead>
          <tbody>
            {report.ranking.signals.map((s) => (
              <tr key={s.key} className="border-t border-ink-800">
                <td className="py-2 pr-3 text-ink-300">{s.label}</td>
                {cell(s.regimes.bull)}
                {cell(s.regimes.bear)}
                {cell(s.regimes.calm)}
                {cell(s.regimes.turbulent)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-400">
        India VIX is split at its development-period median
        {report.ranking.vixMedian == null ? ' (no VIX data)' : ` of ${report.ranking.vixMedian.toFixed(1)}`}. The blended forecast called direction
        right {pct(bull.hitRate)} of the time when NIFTY was above its 200-day average (prices rose {pct(bull.upRate)}), and {pct(bear.hitRate)}{' '}
        when below (rose {pct(bear.upRate)}).
      </p>
    </Card>
  );
}

function YearCard({ report }: { report: ResearchReport }) {
  return (
    <Card title="Forecasts year by year" subtitle="An edge that only shows up in one or two years isn't one.">
      <div className="scroll-area max-h-96">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 bg-ink-900">
            <tr className="text-xs text-ink-400">
              <th className={`${TH} text-left`}>Year</th>
              <th className={`${TH} text-right`}>Forecasts</th>
              <th className={`${TH} text-right`}>Blend error</th>
              <th className={`${TH} text-right`}>No-change error</th>
              <th className={`${TH} text-right`}>Direction right</th>
              <th className={`${TH} text-right`}>Prices rose</th>
            </tr>
          </thead>
          <tbody>
            {report.forecasts.byYear.map((y) => (
              <tr key={y.year} className="border-t border-ink-800">
                <td className="py-2 pr-3">{y.year}</td>
                <td className={`${TD} text-right text-ink-400`}>{y.predictions.toLocaleString('en-IN')}</td>
                <td className={`${TD} text-right ${y.ensembleError < y.baselineError ? 'text-emerald-400' : ''}`}>{pct(y.ensembleError)}</td>
                <td className={`${TD} text-right`}>{pct(y.baselineError)}</td>
                <td className={`${TD} text-right`}>{pct(y.hitRate)}</td>
                <td className={`${TD} text-right text-ink-400`}>{pct(y.upRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MethodCard({ report }: { report: ResearchReport }) {
  const { settings, universe, period } = report;
  return (
    <Card title="How this was tested" subtitle="What the numbers above can and can't tell you.">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
        <li>
          Stocks: today's {universe.stocks} {universe.name} members. Companies dropped from the index over the years aren't included, which flatters
          past results, especially momentum (survivorship bias).
        </li>
        <li>
          No look-ahead: every forecast and ranking uses only prices up to its month-end, and the blend's weights only use earlier forecasts whose
          outcome was already known.
        </li>
        <li>
          Sealed test: outcomes after {formatDate(period.holdoutStart)} weren't used to choose or tune anything, including the range width.
        </li>
        <li>
          Pass rules were fixed before testing: in the development years, a rank correlation above 0 with t of 2 or more, positive in 55% or more of
          months, and a top-20% portfolio beating the average stock after costs. "Confirmed" also needs a positive rank correlation and a win over
          the average stock in the sealed test.
        </li>
        <li>
          Costs: {pct(settings.costRoundTrip)} per round trip on stocks that change each month (STT, brokerage, stamp duty, exchange fees and
          slippage). Taxes aren't included.
        </li>
        <li>
          Stock returns include dividends (adjusted prices); NIFTY 50's don't, which flatters comparisons with NIFTY by about 1–1.5% a year. The
          Sharpe ratio uses a {pct(settings.riskFreeRate)} risk-free rate.
        </li>
        <li>
          {report.ranking.signals.length} ranking signals were tested. When several are tried, one can pass partly by luck, so treat a single
          confirmed signal with some caution. The Dashboard's Rank and the paper portfolio use the confirmed signal with the strongest development
          result, or the pre-chosen composite if none is confirmed.
        </li>
        <li>Prices from Yahoo Finance, which occasionally has missing days or late split adjustments.</li>
      </ul>
    </Card>
  );
}
