import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { checkPassphrase, TRACKING_API, WrongPassphraseError } from '../lib/data/tracking.ts';

// Same key as the Fetch tab's tracking passphrase, so unlocking the site also unlocks daily tracking.
const STORAGE_KEY = 'nse-predictor:tracking-passphrase';

function storedPassphrase(): string {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return typeof stored === 'string' ? stored : '';
  } catch {
    return '';
  }
}

function remember(passphrase: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(passphrase));
  } catch {
    // Storage blocked (e.g. private mode): the site stays unlocked for this visit only.
  }
}

/**
 * Asks for the Cloudflare Worker's passphrase before showing the hosted site. The passphrase is checked by the
 * Worker, so it never ships in the site's code. Skipped when running locally.
 */
export function SiteLock({ children }: { children: ReactNode }) {
  const lockable = !import.meta.env.DEV && TRACKING_API != null;
  const [unlocked, setUnlocked] = useState(() => !lockable || storedPassphrase() !== '');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  // A remembered passphrase opens the site straight away; lock again if it has since been changed on the Worker.
  useEffect(() => {
    const saved = lockable ? storedPassphrase() : '';
    if (!saved) return;
    checkPassphrase(saved).catch((err) => {
      if (!(err instanceof WrongPassphraseError)) return;
      remember('');
      setUnlocked(false);
    });
  }, [lockable]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || checking) return;
    setChecking(true);
    setError('');
    try {
      await checkPassphrase(value);
      remember(value);
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? 'That password is not right.' : "Couldn't check the password. Try again.");
      setChecking(false);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="#2b1f00" />
            <polyline points="4,16 9,11 13,14 20,6" fill="none" stroke="#f5b301" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="text-lg font-semibold tracking-tight">NSE Visor</h1>
        </div>
        <p className="mt-3 text-sm text-ink-400">Enter the password to open the site.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Password"
          className="mt-4 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={checking || !value}
          className="mt-4 w-full rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-accent-500 disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Open'}
        </button>
      </form>
    </div>
  );
}
