/** Yahoo chart requests the Worker and the dev relay will pass on, and how long each may be cached. */
const CHARTS = new Map<string, { ranges: string[]; maxAgeSeconds: number }>([
  ['1d', { ranges: ['10y'], maxAgeSeconds: 900 }],
  ['5m', { ranges: ['1d', '5d', '60d'], maxAgeSeconds: 30 }],
  ['1m', { ranges: ['1d', '5d'], maxAgeSeconds: 30 }],
]);

export type ChartRequest = { query: string; maxAgeSeconds: number };

/** Reads ?interval=&range= (default: ~10 years of daily prices). Null when the combination isn't allowed. */
export function chartRequest(params: URLSearchParams): ChartRequest | null {
  const interval = params.get('interval') ?? '1d';
  const chart = CHARTS.get(interval);
  const range = params.get('range') ?? chart?.ranges[0];
  if (!chart || !range || !chart.ranges.includes(range)) return null;
  return { query: `range=${range}&interval=${interval}`, maxAgeSeconds: chart.maxAgeSeconds };
}
