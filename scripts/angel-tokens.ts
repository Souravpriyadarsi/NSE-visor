// Saves Angel One's NSE instrument tokens (public data, no login needed) to public/data/angel-tokens.json, for the
// optional Angel One market data. Falls back to the copy already on the site if Angel One's file can't be downloaded.
// Optional env: PAGES_URL.
import { downloadAngelTokens, saveAngelTokens } from './angel/tokens.ts';
import type { AngelTokens } from '../src/lib/angel/instruments.ts';

const pagesUrl = process.env.PAGES_URL?.replace(/\/$/, '');

try {
  const file = await downloadAngelTokens();
  await saveAngelTokens(file);
  console.log(`Angel One tokens: ${Object.keys(file.tokens).length} NSE stocks and indices (RELIANCE ${file.tokens['RELIANCE.NS']})`);
} catch (err) {
  console.warn(err instanceof Error ? err.message : String(err));
  const res = pagesUrl ? await fetch(`${pagesUrl}/data/angel-tokens.json`).catch(() => null) : null;
  if (!res?.ok) process.exit(1);
  await saveAngelTokens((await res.json()) as AngelTokens);
  console.warn('Using the previously deployed Angel One tokens.');
}
