import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import { CHART_COLORS } from '../lib/chartTheme.ts';

type Props = {
  dates: string[];
  values: number[];
  /** Price at the start of the time frame: drawn as a dashed line, and the chart is green above it at the end, red below. */
  base: number;
  format: (value: number) => string;
  /** Index into dates/values under the cursor, or null when the cursor leaves the chart. */
  onHover: (index: number | null) => void;
};

type Parts = { chart: IChartApi; series: ISeriesApi<'Area'>; baseLine: IPriceLine | null };

/** A simple price chart like a broker app's: one shaded line over the chosen time frame. */
export function StockChart({ dates, values, base, format, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<Parts | null>(null);
  const hoverRef = useRef(onHover);

  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: CHART_COLORS.text, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: CHART_COLORS.grid } },
      rightPriceScale: { borderColor: CHART_COLORS.border },
      timeScale: { borderColor: CHART_COLORS.border, fixLeftEdge: true, fixRightEdge: true },
      // The time-frame buttons choose what's shown, so dragging and zooming are off.
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    chart.subscribeCrosshairMove((param) => {
      hoverRef.current(param.point && param.time && param.logical != null ? Math.round(param.logical) : null);
    });
    partsRef.current = { chart, series, baseLine: null };
    return () => {
      chart.remove();
      partsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts || values.length === 0) return;
    const rising = values[values.length - 1] >= base;
    parts.chart.applyOptions({ localization: { priceFormatter: format } });
    parts.series.applyOptions({
      lineColor: rising ? CHART_COLORS.rise : CHART_COLORS.fall,
      topColor: rising ? CHART_COLORS.riseFill : CHART_COLORS.fallFill,
      bottomColor: 'rgba(0, 0, 0, 0)',
    });
    parts.series.setData(dates.map((time, i) => ({ time, value: values[i] })));
    if (parts.baseLine) parts.series.removePriceLine(parts.baseLine);
    parts.baseLine = parts.series.createPriceLine({
      price: base,
      color: CHART_COLORS.guide,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    });
    parts.chart.timeScale().fitContent();
  }, [dates, values, base, format]);

  return <div ref={containerRef} className="h-[360px] w-full" />;
}
