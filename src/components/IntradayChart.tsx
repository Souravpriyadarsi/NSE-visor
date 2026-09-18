import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { CHART_COLORS } from '../lib/chartTheme.ts';
import { IST_OFFSET_SECONDS, type IntradayBar } from '../lib/intraday/bars.ts';
import type { ExitReason, OpenPosition, Trade } from '../lib/intraday/simulator.ts';
import type { Side } from '../lib/intraday/strategies.ts';

type Props = {
  bars: IntradayBar[];
  /** The day's VWAP, one value per bar. */
  vwap?: number[];
  trades: Trade[];
  open?: OpenPosition | null;
  format: (value: number) => string;
  /** Other orders to mark, e.g. the Algo trading bot's buys and sells. */
  marks?: ChartMark[];
  /** Other price levels to draw, e.g. a trailing stop. */
  levels?: ChartLevel[];
};

export type ChartMark = { time: number; side: 'buy' | 'sell'; text: string };
export type ChartLevel = { price: number; title: string; tone: 'rise' | 'fall' | 'guide' };

type Parts = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  vwap: ISeriesApi<'Line'>;
  markers: ISeriesMarkersPluginApi<Time>;
  lines: IPriceLine[];
};

const EXIT_TEXT: Record<ExitReason, string> = { stop: 'stop', target: 'target', signal: 'exit', 'day-end': '15:15', 'loss-limit': 'loss limit', kill: 'kill' };

/** The chart library shows UTC, so shift times to read as IST on the axis. */
const chartTime = (time: number) => (time + IST_OFFSET_SECONDS) as UTCTimestamp;

function entryMarker(side: Side, time: number, qty: number): SeriesMarker<Time> {
  return side === 1
    ? { time: chartTime(time), position: 'belowBar', shape: 'arrowUp', color: CHART_COLORS.rise, text: `Buy ${qty}` }
    : { time: chartTime(time), position: 'aboveBar', shape: 'arrowDown', color: CHART_COLORS.fall, text: `Short ${qty}` };
}

/** One trading day of 5-minute candles with VWAP, entries (arrows) and exits (circles). */
export function IntradayChart({ bars, vwap, trades, open = null, format, marks, levels }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<Parts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: CHART_COLORS.text, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: CHART_COLORS.grid } },
      rightPriceScale: { borderColor: CHART_COLORS.border },
      timeScale: { borderColor: CHART_COLORS.border, timeVisible: true, secondsVisible: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.rise,
      downColor: CHART_COLORS.fall,
      wickUpColor: CHART_COLORS.rise,
      wickDownColor: CHART_COLORS.fall,
      borderVisible: false,
      priceLineVisible: false,
    });
    const vwapLine = chart.addSeries(LineSeries, {
      color: CHART_COLORS.forecast,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    partsRef.current = { chart, candles, vwap: vwapLine, markers: createSeriesMarkers(candles, []), lines: [] };
    return () => {
      chart.remove();
      partsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    parts.chart.applyOptions({ localization: { priceFormatter: format } });
    parts.candles.setData(bars.map(([time, o, h, l, c]) => ({ time: chartTime(time), open: o, high: h, low: l, close: c })));
    parts.vwap.setData(vwap ? bars.map((bar, i) => ({ time: chartTime(bar[0]), value: vwap[i] })) : []);

    const markers: SeriesMarker<Time>[] = [];
    for (const trade of trades) {
      markers.push(entryMarker(trade.side, trade.entryTime, trade.qty));
      markers.push({
        time: chartTime(trade.exitTime),
        position: trade.side === 1 ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: trade.net >= 0 ? CHART_COLORS.rise : CHART_COLORS.fall,
        text: EXIT_TEXT[trade.reason],
      });
    }
    if (open) markers.push(entryMarker(open.side, open.entryTime, open.qty));
    for (const mark of marks ?? []) {
      markers.push(
        mark.side === 'buy'
          ? { time: chartTime(Math.floor((mark.time - 1) / 300) * 300), position: 'belowBar', shape: 'arrowUp', color: CHART_COLORS.rise, text: mark.text }
          : { time: chartTime(Math.floor((mark.time - 1) / 300) * 300), position: 'aboveBar', shape: 'arrowDown', color: CHART_COLORS.fall, text: mark.text },
      );
    }
    parts.markers.setMarkers(markers.sort((a, b) => (a.time as number) - (b.time as number)));

    for (const line of parts.lines) parts.candles.removePriceLine(line);
    parts.lines = [];
    if (open) {
      const line = (price: number, color: string, title: string) =>
        parts.lines.push(parts.candles.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }));
      line(open.entryPrice, CHART_COLORS.guide, 'entry');
      line(open.stop, CHART_COLORS.fall, 'stop');
      if (open.target != null) line(open.target, CHART_COLORS.rise, 'target');
    }
    for (const level of levels ?? []) {
      const color = level.tone === 'rise' ? CHART_COLORS.rise : level.tone === 'fall' ? CHART_COLORS.fall : CHART_COLORS.guide;
      parts.lines.push(
        parts.candles.createPriceLine({ price: level.price, color, title: level.title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true }),
      );
    }
    parts.chart.timeScale().fitContent();
  }, [bars, vwap, trades, open, format, marks, levels]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
