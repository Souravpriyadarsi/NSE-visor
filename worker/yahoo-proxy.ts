// Cloudflare Worker for the hosted app:
//   GET  /?symbol=IRFC.NS         relays Yahoo Finance daily prices (browsers can't call Yahoo directly)
//   GET  /tracked                 the list of extra stocks the daily GitHub Action tracks
//   PUT  /tracked  {symbol,name}  add a stock      (needs the passphrase)
//   DELETE /tracked?symbol=X      remove a stock   (needs the passphrase)
//   GET  /tracked/check           check a passphrase
// Deploy: see "Fetch and track any stock on the hosted site" in the README.
import { isValidSymbol } from '../src/lib/data/symbols.ts';

type KV = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };

type Env = {
  /** Comma-separated sites allowed to use this Worker, e.g. "https://you.github.io". */
  ALLOWED_ORIGINS?: string;
  /** Set with `npx wrangler secret put TRACK_PASSPHRASE`. */
  TRACK_PASSPHRASE?: string;
  TRACKED: KV;
};

type Stock = { symbol: string; name: string };

const LIST_KEY = 'tracked-stocks';
const MAX_TRACKED = 150;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
    const cors: Record<string, string> = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : { Vary: 'Origin' };
    const reply = (body: string | null, status: number, headers: Record<string, string> = {}) =>
      new Response(body, { status, headers: { ...cors, ...headers } });
    const json = (value: unknown, status = 200) =>
      reply(JSON.stringify(value), status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

    if (request.method === 'OPTIONS') {
      return reply(null, 204, {
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/tracked' || url.pathname === '/tracked/check') {
      if (request.method === 'GET' && url.pathname === '/tracked') return json(await readList(env));
      if (!(await authorized(request, env))) return reply('Wrong passphrase', 401);
      if (url.pathname === '/tracked/check') return reply(null, 204);

      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as Partial<Stock> | null;
        const symbol = String(body?.symbol ?? '').toUpperCase();
        const name = String(body?.name ?? '').trim().slice(0, 100);
        if (!isValidSymbol(symbol) || !name) return reply('Invalid stock', 400);
        const list = (await readList(env)).filter((s) => s.symbol !== symbol);
        if (list.length >= MAX_TRACKED) return reply(`You can track up to ${MAX_TRACKED} extra stocks`, 409);
        list.push({ symbol, name });
        list.sort((a, b) => a.symbol.localeCompare(b.symbol));
        await env.TRACKED.put(LIST_KEY, JSON.stringify(list));
        return json(list);
      }

      if (request.method === 'DELETE') {
        const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
        const list = (await readList(env)).filter((s) => s.symbol !== symbol);
        await env.TRACKED.put(LIST_KEY, JSON.stringify(list));
        return json(list);
      }
      return reply('Method not allowed', 405);
    }

    if (request.method !== 'GET') return reply('Method not allowed', 405);

    // Only daily charts for well-formed tickers, so this can't be used as a general-purpose proxy.
    const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
    if (!isValidSymbol(symbol)) return reply('Invalid symbol', 400);

    const upstream = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': upstream.ok ? 'public, max-age=900' : 'no-store',
      },
    });
  },
};

async function readList(env: Env): Promise<Stock[]> {
  try {
    const list: unknown = JSON.parse((await env.TRACKED.get(LIST_KEY)) ?? '[]');
    return Array.isArray(list) ? (list as Stock[]) : [];
  } catch {
    return [];
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares hashes rather than the raw strings, so response timing doesn't leak the passphrase. */
async function authorized(request: Request, env: Env): Promise<boolean> {
  if (!env.TRACK_PASSPHRASE) return false;
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return given.length > 0 && (await sha256(given)) === (await sha256(env.TRACK_PASSPHRASE));
}
