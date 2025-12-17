import type { PlatformAdapter, ApiSettings, Theme } from '../platform';
import { getSettingsFromDb, saveSettingToDb } from './common';

const THEME_KEY = 'bookmark-rag-theme';

const CORS_PROXIES = [
  {
    name: 'corsproxy.io',
    format: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`
  },
  {
    name: 'allorigins',
    format: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  },
];

export const webAdapter: PlatformAdapter = {
  async getSettings(): Promise<ApiSettings> {
    return getSettingsFromDb();
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
    return saveSettingToDb(key, value);
  },

  async getTheme(): Promise<Theme> {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      return (theme as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  },

  async setTheme(theme: Theme): Promise<void> {
    localStorage.setItem(THEME_KEY, theme);
  },

  async fetchContent(url: string): Promise<{ html: string; finalUrl: string }> {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const html = await response.text();
        return { html, finalUrl: response.url || url };
      }
    } catch (e) {
      console.log('Direct fetch failed, trying CORS proxies:', e);
    }

    for (const proxy of CORS_PROXIES) {
      try {
        const proxyUrl = proxy.format(url);
        const response = await fetch(proxyUrl);
        if (response.ok) {
          const html = await response.text();
          return { html, finalUrl: url };
        }
      } catch (e) {
        console.log(`CORS proxy ${proxy.name} failed:`, e);
        continue;
      }
    }

    throw new Error('Failed to fetch content: All methods failed (direct fetch and CORS proxies)');
  },
};
