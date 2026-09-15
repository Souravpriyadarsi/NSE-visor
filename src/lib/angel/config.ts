import { isValidSymbol, normalizeSymbol } from '../data/symbols.ts';
import type { AngelCredentials } from './api.ts';

/** Most stocks whose depth is recorded at once. */
export const MAX_RECORDED = 10;

export type AngelConfig = { credentials: AngelCredentials; record: string[] };

/** Reads the ANGEL_* settings from .env.local. Null when any required one is missing. */
export function readAngelConfig(env: Record<string, string | undefined>): AngelConfig | null {
  const get = (name: string) => env[name]?.trim() ?? '';
  const [apiKey, clientCode, pin, totpSecret] = ['ANGEL_API_KEY', 'ANGEL_CLIENT_CODE', 'ANGEL_PIN', 'ANGEL_TOTP_SECRET'].map(get);
  if (!apiKey || !clientCode || !pin || !totpSecret) return null;
  const record = [
    ...new Set(
      get('ANGEL_RECORD')
        .split(',')
        .map(normalizeSymbol)
        .filter((symbol) => symbol && isValidSymbol(symbol)),
    ),
  ].slice(0, MAX_RECORDED);
  return { credentials: { apiKey, historicalApiKey: get('ANGEL_HISTORICAL_API_KEY') || undefined, clientCode, pin, totpSecret }, record };
}
