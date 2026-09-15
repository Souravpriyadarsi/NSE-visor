import type { AngelInterval, CandleRow } from './candles.ts';
import type { DepthLevel } from './stream.ts';
import { totp } from './totp.ts';

/**
 * Angel One SmartAPI, market data only: login, quotes with depth, and candles. There is deliberately no order code.
 * Works anywhere with fetch and Web Crypto (Node, Cloudflare Workers).
 */
export const ANGEL_ROOT = 'https://apiconnect.angelone.in';

export type AngelCredentials = {
  apiKey: string;
  /** Only needed if Angel One issued a separate key for historical data. */
  historicalApiKey?: string;
  clientCode: string;
  pin: string;
  totpSecret: string;
};

export type AngelSession = { jwtToken: string; refreshToken: string; feedToken: string; loggedInAt: number };

export type QuoteRow = {
  symbolToken: string;
  tradingSymbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tradeVolume: number;
  totBuyQuan: number;
  totSellQuan: number;
  exchFeedTime: string;
  depth: { buy: DepthLevel[]; sell: DepthLevel[] };
};

export class AngelApiError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Login was refused: retrying with the same details could lock the account, so it isn't retried automatically. */
export class AngelLoginError extends AngelApiError {}

type Envelope<T> = { status: boolean; message: string; errorcode: string; data: T };

const SESSION_ERRORS = new Set(['AG8001', 'AG8002', 'AG8003']);
/** Angel One allows 1 quote request a second; historical requests are spaced a little too. */
const QUOTE_GAP_MS = 1100;
const CANDLE_GAP_MS = 400;
/** Sessions end daily; log in again well before that. */
const SESSION_MAX_AGE_MS = 12 * 3600_000;

export class SmartApi {
  private session: AngelSession | null = null;
  private loggingIn: Promise<AngelSession> | null = null;
  private readonly nextSlot = new Map<string, number>();
  loginError: string | null = null;
  private readonly credentials: AngelCredentials;

  constructor(credentials: AngelCredentials) {
    this.credentials = credentials;
  }

  get loggedIn(): boolean {
    return this.session != null;
  }

  clearSession(): void {
    this.session = null;
  }

  async ensureSession(): Promise<AngelSession> {
    if (this.session && Date.now() - this.session.loggedInAt < SESSION_MAX_AGE_MS) return this.session;
    return this.login();
  }

  login(): Promise<AngelSession> {
    if (this.loginError) return Promise.reject(new AngelLoginError(this.loginError));
    this.loggingIn ??= this.doLogin().finally(() => (this.loggingIn = null));
    return this.loggingIn;
  }

  private async doLogin(): Promise<AngelSession> {
    const { clientCode, pin, totpSecret } = this.credentials;
    const res = await fetch(`${ANGEL_ROOT}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      method: 'POST',
      headers: this.headers(this.credentials.apiKey, null),
      body: JSON.stringify({ clientcode: clientCode, password: pin, totp: await totp(totpSecret) }),
    });
    const json = (await res.json().catch(() => null)) as Envelope<{ jwtToken: string; refreshToken: string; feedToken: string }> | null;
    if (!res.ok || !json?.status || !json.data?.jwtToken) {
      this.loginError = `Angel One login failed: ${json?.message || `HTTP ${res.status}`}`;
      throw new AngelLoginError(this.loginError, json?.errorcode);
    }
    this.session = { ...json.data, loggedInAt: Date.now() };
    return this.session;
  }

  /** Best 5 depth and day stats for up to 50 NSE tokens per request. */
  async quote(tokens: string[]): Promise<QuoteRow[]> {
    const rows: QuoteRow[] = [];
    for (let i = 0; i < tokens.length; i += 50) {
      await this.waitTurn('quote', QUOTE_GAP_MS);
      const data = await this.post<{ fetched: QuoteRow[] }>('/rest/secure/angelbroking/market/v1/quote/', {
        mode: 'FULL',
        exchangeTokens: { NSE: tokens.slice(i, i + 50) },
      });
      rows.push(...(data?.fetched ?? []));
    }
    return rows;
  }

  /** `from`/`to` like "2026-09-15 09:15" (IST). */
  async candles(token: string, interval: AngelInterval, from: string, to: string): Promise<CandleRow[]> {
    await this.waitTurn('candles', CANDLE_GAP_MS);
    const data = await this.post<CandleRow[] | null>(
      '/rest/secure/angelbroking/historical/v1/getCandleData',
      { exchange: 'NSE', symboltoken: token, interval, fromdate: from, todate: to },
      this.credentials.historicalApiKey || this.credentials.apiKey,
    );
    return data ?? [];
  }

  private async post<T>(path: string, body: unknown, apiKey = this.credentials.apiKey, retry = true): Promise<T> {
    const session = await this.ensureSession();
    const res = await fetch(`${ANGEL_ROOT}${path}`, { method: 'POST', headers: this.headers(apiKey, session), body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (retry && (res.status === 401 || SESSION_ERRORS.has(json?.errorcode ?? ''))) {
      this.session = null;
      return this.post(path, body, apiKey, false);
    }
    if (!res.ok || !json?.status) throw new AngelApiError(`Angel One: ${json?.message || `HTTP ${res.status}`}`, json?.errorcode);
    return json.data;
  }

  private headers(apiKey: string, session: AngelSession | null): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00:00:00:00:00:00',
      'X-PrivateKey': apiKey,
      ...(session ? { Authorization: `Bearer ${session.jwtToken}` } : {}),
    };
  }

  private async waitTurn(kind: string, gapMs: number): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot.get(kind) ?? 0);
    this.nextSlot.set(kind, at + gapMs);
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}
