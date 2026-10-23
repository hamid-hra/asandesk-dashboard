import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

function initial(): Theme {
  try {
    const saved = localStorage.getItem('asw_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = initial();
const subs = new Set<() => void>();

function apply() {
  document.documentElement.dataset.theme = current;
}
apply();

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem('asw_theme', theme);
  } catch {
    /* ignore */
  }
  apply();
  for (const s of subs) s();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}
