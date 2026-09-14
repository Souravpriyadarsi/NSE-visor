import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineSeriesPartialOptions,
  type Time,
} from 'lightweight-charts';
import type { Analysis } from '../lib/analyze.ts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { subtractMonths } from '../lib/dates.ts';
import type { Series } from '../lib/indicators/indicators.ts';

const COLORS = CHART_COLORS;

const RANGES = [
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '5Y', months: 60 },
  { label: 'Max', months: 0 },
] as const;
type RangeLabel = (typeof RANGES)[number]['label'];

type ChartParts = {
  chart: IChartApi;
  price: ISeriesApi<'Line'>;
  sma50: ISeriesApi<'Line'>;
  sma200: ISeriesApi<'Line'>;
  forecast: ISeriesApi<'Line'>;
  bandHigh: ISeriesApi<'Line'>;
  bandLow: ISeriesApi<'Line'>;
  rsi: ISeriesApi<'Line'>;
  macdLine: ISeriesApi<'Line'>;
  macdSignal: ISeriesApi<'Line'>;
  macdHistogram: ISeriesApi<'Histogram'>;
};

function toPoints(dates: string[], values: Series): { time: Time; value: number }[] {
  const points: { time: Time; value: number }[] = [];
  values.forEach((value, i) => {
    if (value != null) points.push({ time: dates[i], value });
  });
  return points;
}

export function PriceChart({ analysis }: { analysis: Analysis }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<ChartParts | null>(null);
  const [range, setRange] = useState<RangeLabel>('1Y');
  const [showAverages, setShowAverages] = useState(true);

  // Create the chart once. Pane 0: prices + forecast, pane 1: RSI, pane 2: MACD.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.text,
        fontSize: 11,
        panes: { separatorColor: COLORS.border },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-IN', { maximumFractionDigits: 2 }) },
    });

    const line = (color: string, options: LineSeriesPartialOptions = {}, pane = 0) =>
      chart.addSeries(
        LineSeries,
        { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...options },
        pane,
      );

    const rsi = line(COLORS.rsi, { lastValueVisible: true }, 1);
    for (const level of [70, 30]) {
      rsi.createPriceLine({ price: level, color: COLORS.guide, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true });
    }

    partsRef.current = {
      chart,
      price: line(COLORS.price, { lineWidth: 2, lastValueVisible: true, crosshairMarkerVisible: true }),
      sma50: line(COLORS.sma50),
      sma200: line(COLORS.sma200),
      forecast: line(COLORS.forecast, { lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: true }),
      bandHigh: line(COLORS.band, { lineStyle: LineStyle.Dotted }),
      bandLow: line(COLORS.band, { lineStyle: LineStyle.Dotted }),
      rsi,
      macdHistogram: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2),
      macdLine: line(COLORS.macd, {}, 2),
      macdSignal: line(COLORS.signal, {}, 2),
    };

    const panes = chart.panes();
    panes[1]?.setHeight(100);
    panes[2]?.setHeight(100);

    return () => {
      partsRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const { dates, closes, indicators, forecast } = analysis;

    parts.price.setData(dates.map((time, i) => ({ time, value: closes[i] })));
    parts.sma50.setData(showAverages ? toPoints(dates, indicators.sma50) : []);
    parts.sma200.setData(showAverages ? toPoints(dates, indicators.sma200) : []);

    const anchor = { time: dates[dates.length - 1], value: closes[closes.length - 1] };
    const path = (values: number[]) =>
      forecast ? [anchor, ...forecast.dates.map((time, k) => ({ time, value: values[k] }))] : [];
    parts.forecast.setData(path(forecast?.mid ?? []));
    parts.bandHigh.setData(path(forecast?.high ?? []));
    parts.bandLow.setData(path(forecast?.low ?? []));

    parts.rsi.setData(toPoints(dates, indicators.rsi));
    parts.macdLine.setData(toPoints(dates, indicators.macd.macd));
    parts.macdSignal.setData(toPoints(dates, indicators.macd.signal));
    parts.macdHistogram.setData(
      toPoints(dates, indicators.macd.histogram).map((p) => ({ ...p, color: p.value >= 0 ? COLORS.up : COLORS.down })),
    );
  }, [analysis, showAverages]);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const months = RANGES.find((r) => r.label === range)?.months ?? 0;
    const lastDate = analysis.dates[analysis.dates.length - 1];
    const end = analysis.forecast?.dates.at(-1) ?? lastDate;
    if (months === 0) parts.chart.timeScale().fitContent();
    else parts.chart.timeScale().setVisibleRange({ from: subtractMonths(lastDate, months), to: end });
  }, [analysis, range]);

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
          <Legend color={COLORS.price} label="Close" />
          {showAverages && (
            <>
              <Legend color={COLORS.sma50} label="50-day avg" />
              <Legend color={COLORS.sma200} label="200-day avg" />
            </>
          )}
          <Legend color={COLORS.forecast} label="Forecast" dashed />
          <Legend color={COLORS.band} label="80% range" dashed />
          <span className="text-ink-500">Lower panes: RSI (14) · MACD (12, 26, 9)</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-400">
            <input
              type="checkbox"
              checked={showAverages}
              onChange={(e) => setShowAverages(e.target.checked)}
              className="accent-accent-500"
            />
            Averages
          </label>
          <div className="flex rounded-lg border border-ink-700 p-0.5" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRange(r.label)}
                aria-pressed={range === r.label}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  range === r.label ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={containerRef} className="h-[440px] w-full sm:h-[540px]" />
    </section>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-4 border-t-2" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
      {label}
    </span>
  );
}
