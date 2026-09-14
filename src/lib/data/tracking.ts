import type { SymbolInfo } from '../../types.ts';

/** The Cloudflare Worker that stores which extra stocks the daily GitHub Action tracks. */
export const TRACKING_API: string | null = import.meta.env.VITE_YAHOO_PROXY_URL?.trim().replace(/\/$/, '') || null;

export class WrongPassphraseError extends Error {}

async function call(path: string, init: RequestInit = {}, passphrase?: string): Promise<Response> {
  if (!TRACKING_API) throw new Error('Daily tracking needs the Cloudflare Worker (see the README).');
  const headers = new Headers(init.headers);
  if (passphrase) headers.set('Authorization', `Bearer ${passphrase}`);
  const res = await fetch(`${TRACKING_API}${path}`, { ...init, headers });
  if (res.status === 401) throw new WrongPassphraseError('That passphrase is not right.');
  if (!res.ok) throw new Error((await res.text()) || `Request failed (HTTP ${res.status})`);
  return res;
}

export async function fetchTrackedList(): Promise<SymbolInfo[]> {
  return (await (await call('/tracked')).json()) as SymbolInfo[];
}

export async function checkPassphrase(passphrase: string): Promise<void> {
  await call('/tracked/check', {}, passphrase);
}

export async function setTracked(stock: SymbolInfo, track: boolean, passphrase: string): Promise<SymbolInfo[]> {
  const res = track
    ? await call('/tracked', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stock) }, passphrase)
    : await call(`/tracked?symbol=${encodeURIComponent(stock.symbol)}`, { method: 'DELETE' }, passphrase);
  return (await res.json()) as SymbolInfo[];
}
