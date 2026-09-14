export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class SymbolNotFoundError extends Error {}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Raw chart JSON, by default ~10 years of daily prices. Yahoo rejects requests without a User-Agent (HTTP 429). */
export async function fetchChart(symbol: string, retries = 3, query = 'range=10y&interval=1d'): Promise<unknown> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
  let lastError: unknown = new Error(`Could not fetch ${symbol}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.json();
      if (res.status === 404) throw new SymbolNotFoundError(`Yahoo Finance has no data for ${symbol}`);
      lastError = new Error(`Yahoo Finance returned HTTP ${res.status} for ${symbol}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      if (err instanceof SymbolNotFoundError) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
