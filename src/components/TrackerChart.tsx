import { useEffect, useRef } from 'react';
import { ColorType, createChart, LineSeries, LineStyle, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { CHART_COLORS } from '../lib/chartTheme.ts';

export type Point = { time: string; value: number };

type Props = {
  /** Closing prices. */
  actual: Point[];
  /** Each saved prediction, plotted at the date it was predicting (22 trading days after it was made). */
  targets: Point[];
  /** The full 22-day path of the selected prediction. */
  path: Point[];
};

const COLORS = CHART_COLORS;

export function TrackerChart({ actual, targets, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<{ chart: IChartApi; actual: ISeriesApi<'Line'>; targets: ISeriesApi<'Line'>; path: ISeriesApi<'Line'> } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: COLORS.text, fontSize: 11 },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-IN', { maximumFractionDigits: 2 }) },
    });
    const base = { priceLineVisible: false, lastValueVisible: false };
    partsRef.current = {
      chart,
      actual: chart.addSeries(LineSeries, { ...base, color: COLORS.actual, lineWidth: 2 }),
      targets: chart.addSeries(LineSeries, { ...base, color: COLORS.predicted, lineWidth: 2, pointMarkersVisible: true }),
      path: chart.addSeries(LineSeries, { ...base, color: COLORS.path, lineWidth: 2, lineStyle: LineStyle.Dashed }),
    };
    return () => {
      partsRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    parts.actual.setData(actual);
    parts.targets.setData(targets);
    parts.path.setData(path);
    parts.chart.timeScale().fitContent();
  }, [actual, targets, path]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
        <Legend color={COLORS.actual} label="Actual close" />
        <Legend color={COLORS.predicted} label="Price predicted 1 month earlier" />
        <Legend color={COLORS.path} label="Selected prediction's path" dashed />
      </div>
      <div ref={containerRef} className="h-[360px] w-full" />
    </div>
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
