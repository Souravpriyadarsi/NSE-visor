import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SCRIP_MASTER_URL, toAngelTokens, type AngelTokens, type ScripRow } from '../../src/lib/angel/instruments.ts';

export const TOKENS_FILE = new URL('../../public/data/angel-tokens.json', import.meta.url);
const MAX_AGE_MS = 7 * 86400_000;

/** Downloads Angel One's public instrument list and keeps NSE stocks and indices. */
export async function downloadAngelTokens(): Promise<AngelTokens> {
  const res = await fetch(SCRIP_MASTER_URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Angel One's instrument list returned HTTP ${res.status}`);
  const tokens = toAngelTokens((await res.json()) as ScripRow[]);
  if (Object.keys(tokens).length < 1000) throw new Error(`Angel One's instrument list only had ${Object.keys(tokens).length} NSE stocks`);
  return { updatedAt: new Date().toISOString(), tokens };
}

export async function saveAngelTokens(file: AngelTokens): Promise<void> {
  await mkdir(new URL('.', TOKENS_FILE), { recursive: true });
  await writeFile(TOKENS_FILE, JSON.stringify(file));
}

async function readSaved(): Promise<AngelTokens | null> {
  try {
    return JSON.parse(await readFile(TOKENS_FILE, 'utf8')) as AngelTokens;
  } catch {
    return null;
  }
}

/** The saved token list, downloaded again when missing or over a week old (tokens rarely change). */
export async function angelTokens(): Promise<AngelTokens> {
  const saved = await readSaved();
  if (saved && Date.now() - Date.parse(saved.updatedAt) < MAX_AGE_MS) return saved;
  try {
    const fresh = await downloadAngelTokens();
    await saveAngelTokens(fresh);
    return fresh;
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
}
