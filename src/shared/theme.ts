// Theme management utilities

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

const THEME_STORAGE_KEY = 'bookmark-rag-theme';

/**
 * Get the current theme preference from storage
 */
export async function getTheme(): Promise<Theme> {
  try {
    const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
    return (result[THEME_STORAGE_KEY] as Theme) || 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Set the theme preference in storage and apply it
 */
export async function setTheme(theme: Theme): Promise<void> {
  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  applyTheme(theme);
}

/**
 * Apply the theme to the document
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Remove any existing theme data attribute
  root.removeAttribute('data-theme');

  // Apply the appropriate theme
  if (theme === 'auto') {
    // Let the CSS media query handle it - no data-theme attribute needed
    return;
  }

  root.setAttribute('data-theme', theme);
}

/**
 * Initialize the theme on page load
 */
export async function initTheme(): Promise<void> {
  const theme = await getTheme();
  applyTheme(theme);
}

/**
 * Get the effective theme (resolves 'auto' to actual light/dark)
 */
export function getEffectiveTheme(theme: Theme): 'light' | 'dark' | 'terminal' | 'tufte' {
  if (theme === 'terminal') return 'terminal';
  if (theme === 'tufte') return 'tufte';
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';

  // Auto - check system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Listen for theme changes from storage (for syncing across pages)
 */
export function onThemeChange(callback: (theme: Theme) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[THEME_STORAGE_KEY]) {
      const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme;
      callback(newTheme);
    }
  });
}
