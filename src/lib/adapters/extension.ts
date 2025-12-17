import type { PlatformAdapter, ApiSettings, Theme } from '../platform';
import { getSettingsFromDb, saveSettingToDb } from './common';

const THEME_STORAGE_KEY = 'bookmark-rag-theme';

export const extensionAdapter: PlatformAdapter = {
  async getSettings(): Promise<ApiSettings> {
    return getSettingsFromDb();
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
    return saveSettingToDb(key, value);
  },

  async getTheme(): Promise<Theme> {
    try {
      const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      return (result[THEME_STORAGE_KEY] as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  },

  async setTheme(theme: Theme): Promise<void> {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  },
};
