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

export function onThemeChange(callback: (theme: Theme) => void): void {
  if (__IS_WEB__) {
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue !== null && event.newValue !== '') {
        callback(event.newValue as Theme);
      }
    });
  } else {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && THEME_STORAGE_KEY in changes) {
        const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme;
        callback(newTheme);
      }
    });
  }
}
