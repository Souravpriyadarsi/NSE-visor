import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fetchChart, SymbolNotFoundError } from './scripts/yahoo-fetch.ts';
import { isValidSymbol } from './src/lib/data/symbols.ts';

const CACHE_MS = 10 * 60 * 1000;

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
        const symbol = (new URL(req.url ?? '/', 'http://localhost').searchParams.get('symbol') ?? '').toUpperCase();
        if (!isValidSymbol(symbol)) return send(400, 'Invalid symbol');

        const hit = cache.get(symbol);
        if (hit && Date.now() - hit.at < CACHE_MS) return send(200, hit.body, 'application/json');

        try {
          const body = JSON.stringify(await fetchChart(symbol, 1));
          cache.set(symbol, { at: Date.now(), body });
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
