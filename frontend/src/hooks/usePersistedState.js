import { useEffect, useState } from "react";

/**
 * useState whose value survives a page reload by mirroring to localStorage.
 * Used to remember the current page/tab so reloading doesn't bounce the user
 * back to the default screen. Pass a key unique to the thing being remembered
 * (e.g. scoped by user id) so it never leaks across accounts.
 */
export function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      if (value === undefined || value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode / quota) — degrade silently */
    }
  }, [key, value]);

  return [value, setValue];
}
