import { useEffect, useState } from 'react';

/** State saved in localStorage. `parse` returns null when the stored value isn't usable. */
export function useLocalStorageState<T>(key: string, fallback: T, parse: (stored: unknown) => T | null) {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked (e.g. private mode): the value lasts for this visit only.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
