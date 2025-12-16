import { db } from '../../db/schema';
import type { PlatformAdapter, ApiSettings, Theme } from '../platform';
import { DEFAULT_API_BASE_URL } from '../constants';

const THEME_KEY = 'bookmark-rag-theme';

const DEFAULTS: ApiSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  // WebDAV defaults
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavPath: '/bookmarks',
  webdavEnabled: false,
  webdavAllowInsecure: false, // Require HTTPS by default for security
  // WebDAV sync state defaults
  webdavSyncInterval: 15, // 15 minutes default
  webdavLastSyncTime: '',
  webdavLastSyncError: '',
};

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

/**
 * Web platform adapter
 * - Uses IndexedDB (Dexie) for settings (same as extension)
 * - Uses localStorage for theme (chrome.storage not available)
 * - Uses CORS proxies for content fetching
 */
export const webAdapter: PlatformAdapter = {
  async getSettings(): Promise<ApiSettings> {
    // Use IndexedDB via Dexie - same as extension adapter
    const rows = await db.settings.toArray();
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    return {
      apiBaseUrl: map.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
      apiKey: map.apiKey ?? DEFAULTS.apiKey,
      chatModel: map.chatModel ?? DEFAULTS.chatModel,
      embeddingModel: map.embeddingModel ?? DEFAULTS.embeddingModel,
      // WebDAV fields
      webdavUrl: map.webdavUrl ?? DEFAULTS.webdavUrl,
      webdavUsername: map.webdavUsername ?? DEFAULTS.webdavUsername,
      webdavPassword: map.webdavPassword ?? DEFAULTS.webdavPassword,
      webdavPath: map.webdavPath ?? DEFAULTS.webdavPath,
      webdavEnabled: map.webdavEnabled ?? DEFAULTS.webdavEnabled,
      webdavAllowInsecure: map.webdavAllowInsecure ?? DEFAULTS.webdavAllowInsecure,
      // WebDAV sync state
      webdavSyncInterval: map.webdavSyncInterval ?? DEFAULTS.webdavSyncInterval,
      webdavLastSyncTime: map.webdavLastSyncTime ?? DEFAULTS.webdavLastSyncTime,
      webdavLastSyncError: map.webdavLastSyncError ?? DEFAULTS.webdavLastSyncError,
    };
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
    // Use IndexedDB via Dexie - same as extension adapter
    const now = new Date();
    const existing = await db.settings.get(key);

    if (existing) {
      await db.settings.update(key, { value, updatedAt: now });
    } else {
      await db.settings.add({ key, value, createdAt: now, updatedAt: now });
    }
  },

  async getTheme(): Promise<Theme> {
    // Use localStorage since chrome.storage isn't available in web
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
    // Try direct fetch first
    try {
      const response = await fetch(url);
      if (response.ok) {
        const html = await response.text();
        return { html, finalUrl: response.url || url };
      }
    } catch (e) {
      console.log('Direct fetch failed, trying CORS proxies:', e);
    }

    // Try CORS proxies in sequence
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
