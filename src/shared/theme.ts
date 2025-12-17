import { getPlatformAdapter } from '../lib/platform';

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

const THEME_STORAGE_KEY = 'bookmark-rag-theme';

export async function getTheme(): Promise<Theme> {
  return getPlatformAdapter().getTheme();
}

export async function setTheme(theme: Theme): Promise<void> {
  await getPlatformAdapter().setTheme(theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  root.removeAttribute('data-theme');

  if (theme === 'auto') {
    return;
  }

  root.setAttribute('data-theme', theme);
}

export async function initTheme(): Promise<void> {
  const theme = await getTheme();
  applyTheme(theme);
}

export function getEffectiveTheme(theme: Theme): 'light' | 'dark' | 'terminal' | 'tufte' {
  if (theme === 'terminal') return 'terminal';
  if (theme === 'tufte') return 'tufte';
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function onThemeChange(callback: (theme: Theme) => void): void {
  if (__IS_WEB__) {
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue) {
        callback(event.newValue as Theme);
      }
    });
  } else {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[THEME_STORAGE_KEY]) {
        const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme;
        callback(newTheme);
      }
    });
  }
}
