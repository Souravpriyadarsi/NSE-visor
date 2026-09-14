import { useEffect, useState, type FormEvent } from 'react';

type Props = { error: string; busy: boolean; onSubmit: (passphrase: string) => void; onCancel: () => void };

/** Asks for the tracking passphrase set on the Cloudflare Worker. */
export function PassphraseDialog({ error, busy, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value) onSubmit(value);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="passphrase-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h2 id="passphrase-title" className="text-sm font-semibold">Tracking passphrase</h2>
        <p className="mt-1 text-xs text-ink-400">
          The passphrase you set on your Cloudflare Worker. It's remembered in this browser so you only enter it once.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Passphrase"
          className="mt-4 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-ink-400 hover:text-ink-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value}
            className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-ink-950 hover:bg-accent-500 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
