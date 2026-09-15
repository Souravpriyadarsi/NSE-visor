import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fetchChart, SymbolNotFoundError } from './scripts/yahoo-fetch.ts';
import { chartRequest } from './src/lib/data/chartQuery.ts';
import { isValidSymbol } from './src/lib/data/symbols.ts';

// Dev only: relays Yahoo's chart JSON to the browser (which can't call Yahoo directly, because of CORS).
// It does the same job as the Cloudflare Worker in worker/ does for the hosted site.
function yahooDevRelay(): Plugin {
  const cache = new Map<string, { at: number; body: string }>();
  return {
    name: 'yahoo-dev-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/chart', async (req, res) => {
        const send = (status: number, body: string, type = 'text/plain') => {
          res.statusCode = status;
          res.setHeader('Content-Type', type);
          res.end(body);
        };
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const symbol = (params.get('symbol') ?? '').toUpperCase();
        if (!isValidSymbol(symbol)) return send(400, 'Invalid symbol');
        const chart = chartRequest(params);
        if (!chart) return send(400, 'Invalid interval or range');

        const key = `${symbol}?${chart.query}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < chart.maxAgeSeconds * 1000) return send(200, hit.body, 'application/json');

        try {
          const body = JSON.stringify(await fetchChart(symbol, 1, chart.query));
          cache.set(key, { at: Date.now(), body });
          send(200, body, 'application/json');
        } catch (err) {
          send(err instanceof SymbolNotFoundError ? 404 : 502, err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), yahooDevRelay()],
});
