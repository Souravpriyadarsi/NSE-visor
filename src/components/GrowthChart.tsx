import { useEffect, useRef } from 'react';
import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { CHART_COLORS } from '../lib/chartTheme.ts';

export type GrowthLine = { label: string; color: string; values: number[] };

type Props = { dates: string[]; lines: GrowthLine[] };

/** Growth of ₹1 over time for a few portfolios. */
export function GrowthChart({ dates, lines }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'>[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    chartRef.current = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: CHART_COLORS.text, fontSize: 11 },
      grid: { vertLines: { color: CHART_COLORS.grid }, horzLines: { color: CHART_COLORS.grid } },
      rightPriceScale: { borderColor: CHART_COLORS.border },
      timeScale: { borderColor: CHART_COLORS.border },
      localization: { priceFormatter: (p: number) => `₹${p.toFixed(2)}` },
    });
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const series of seriesRef.current) chart.removeSeries(series);
    seriesRef.current = lines.map((line) => {
      const series = chart.addSeries(LineSeries, { color: line.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      series.setData(dates.map((time, i) => ({ time, value: line.values[i] })));
      return series;
    });
    chart.timeScale().fitContent();
  }, [dates, lines]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
        {lines.map((line) => (
          <span key={line.label} className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2" style={{ borderColor: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
      <div ref={containerRef} className="h-[340px] w-full" />
    </div>
  );
}
