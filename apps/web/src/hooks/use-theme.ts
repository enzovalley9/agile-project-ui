import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const key = 'bmad-project-ui.theme';
const valid = (value: string | null): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system';
export function readTheme(): ThemePreference {
  try {
    return valid(localStorage.getItem(key));
  } catch {
    return 'system';
  }
}
export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#101724' : '#f8faff');
}
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(theme);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(valid(event.newValue));
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  return [
    theme,
    (next: ThemePreference) => {
      setTheme(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* The selected theme still works for this tab. */
      }
    },
  ] as const;
}
