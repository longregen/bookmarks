import { db } from '../../db/schema';
import type { PlatformAdapter, ApiSettings, Theme } from '../platform';

const THEME_STORAGE_KEY = 'bookmark-rag-theme';

const DEFAULTS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  // WebDAV defaults
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavPath: '/bookmarks',
  webdavEnabled: false,
};

/**
 * Extension platform adapter - uses IndexedDB for settings and chrome.storage for theme
 */
export const extensionAdapter: PlatformAdapter = {
  async getSettings(): Promise<ApiSettings> {
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
    };
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean): Promise<void> {
    const now = new Date();
    const existing = await db.settings.get(key);

    if (existing) {
      await db.settings.update(key, { value, updatedAt: now });
    } else {
      await db.settings.add({ key, value, createdAt: now, updatedAt: now });
    }
  },

  async getTheme(): Promise<Theme> {
    try {
      const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
      return (result[THEME_STORAGE_KEY] as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  },

  async setTheme(theme: Theme): Promise<void> {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  },
};
