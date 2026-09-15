import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { ANGEL_INTERVALS, candleRanges, candlesToHistory, type CandleRow } from '../../src/lib/angel/candles.ts';
import { readAngelConfig } from '../../src/lib/angel/config.ts';
import type { AngelTokens } from '../../src/lib/angel/instruments.ts';
import type { DepthTick } from '../../src/lib/angel/stream.ts';
import { isValidSymbol, normalizeSymbol } from '../../src/lib/data/symbols.ts';
import { DepthRecorder } from './recorder.ts';
import { AngelService } from './service.ts';
import { angelTokens } from './tokens.ts';

const MAX_STREAM_SYMBOLS = 5;
const MAX_CANDLE_DAYS = 365;
const STREAM_THROTTLE_MS = 250;
const CANDLE_CACHE_MS = 30_000;
const SETUP_HINT = "Angel One isn't set up: add your SmartAPI details to .env.local (see .env.example) and restart npm run dev.";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Dev only: Angel One market data for the browser, using the details in .env.local. They stay in this Node process.
 *   GET /api/angel/status
 *   GET /api/angel/candles?symbol=RELIANCE.NS&interval=5m&days=100
 *   GET /api/angel/stream?symbols=RELIANCE.NS,INFY.NS   (Server-Sent Events of depth ticks)
 */
export function angelDevApi(): Plugin {
  return {
    name: 'angel-dev-api',
    apply: 'serve',
    configureServer(server) {
      const config = readAngelConfig(loadEnv(server.config.mode, process.cwd(), 'ANGEL_'));
      const service = config ? new AngelService(config.credentials) : null;
      let tokensError: string | null = null;
      let recorder: DepthRecorder | null = null;
      const tokensReady: Promise<AngelTokens | null> = service
        ? angelTokens().catch((err: unknown) => {
            tokensError = `Couldn't load Angel One's instrument list: ${err instanceof Error ? err.message : String(err)}`;
            return null;
          })
        : Promise.resolve(null);

      if (service && config) {
        // Log in straight away, so the page can show whether the details work.
        service.api.login().catch(() => undefined);
        void tokensReady.then((tokens) => {
          if (!tokens || config.record.length === 0) return;
          const stocks = config.record.flatMap((symbol) => (tokens.tokens[symbol] ? [{ symbol, token: tokens.tokens[symbol] }] : []));
          recorder = new DepthRecorder(service, stocks, new URL('../../data-local/depth/', import.meta.url));
          recorder.start();
        });
        server.httpServer?.once('close', () => {
          recorder?.stop();
          service.close();
        });
      }

      const candleCache = new Map<string, { at: number; body: string }>();

      async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/status') {
          const status = service?.status() ?? { loggedIn: false, loginFailed: false, streaming: false, lastTickAt: null, error: null };
          return sendJson(res, 200, { configured: service != null, ...status, error: status.error ?? tokensError, recording: config?.record ?? [] });
        }
        if (!service) return sendJson(res, 503, { error: SETUP_HINT });
        const tokens = await tokensReady;
        if (!tokens) return sendJson(res, 503, { error: tokensError ?? "Couldn't load Angel One's instrument list." });

        if (url.pathname === '/candles') {
          const symbol = normalizeSymbol(url.searchParams.get('symbol') ?? '');
          const interval = url.searchParams.get('interval') === '1m' ? '1m' : '5m';
          const days = Math.min(Math.max(1, Math.round(Number(url.searchParams.get('days')) || 5)), MAX_CANDLE_DAYS);
          const token = isValidSymbol(symbol) ? tokens.tokens[symbol] : undefined;
          if (!token) return sendJson(res, 404, { error: `Angel One has no NSE instrument for ${symbol || 'that symbol'}.` });

          const key = `${symbol}|${interval}|${days}`;
          const hit = candleCache.get(key);
          if (hit && Date.now() - hit.at < CANDLE_CACHE_MS) {
            res.setHeader('Content-Type', 'application/json');
            return void res.end(hit.body);
          }
          const rows: CandleRow[] = [];
          for (const [from, to] of candleRanges(interval, days, new Date())) {
            rows.push(...(await service.api.candles(token, ANGEL_INTERVALS[interval], from, to)));
          }
          const body = JSON.stringify(candlesToHistory(symbol, interval, rows));
          candleCache.set(key, { at: Date.now(), body });
          res.setHeader('Content-Type', 'application/json');
          return void res.end(body);
        }

        if (url.pathname === '/stream') {
          const symbols = [...new Set((url.searchParams.get('symbols') ?? '').split(',').map(normalizeSymbol))]
            .filter((symbol) => tokens.tokens[symbol])
            .slice(0, MAX_STREAM_SYMBOLS);
          const symbolOf = new Map(symbols.map((symbol) => [tokens.tokens[symbol], symbol]));
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(': connected\n\n');

          const sentAt = new Map<string, number>();
          const waiting = new Map<string, DepthTick>();
          const send = (tick: DepthTick) => {
            const symbol = symbolOf.get(tick.token);
            if (!symbol) return;
            if (Date.now() - (sentAt.get(tick.token) ?? 0) < STREAM_THROTTLE_MS) {
              waiting.set(tick.token, tick);
              return;
            }
            sentAt.set(tick.token, Date.now());
            res.write(`data: ${JSON.stringify({ symbol, tick })}\n\n`);
          };
          const flushWaiting = setInterval(() => {
            for (const [token, tick] of waiting) {
              waiting.delete(token);
              sentAt.delete(token);
              send(tick);
            }
          }, STREAM_THROTTLE_MS);
          const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
          const unwatch = service.watch([...symbolOf.keys()], send);
          req.on('close', () => {
            clearInterval(flushWaiting);
            clearInterval(heartbeat);
            unwatch();
          });
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
      }

      server.middlewares.use('/api/angel', (req, res) => {
        handle(req, res).catch((err: unknown) => {
          if (!res.headersSent) sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
          else res.end();
        });
      });
    },
  };
}
