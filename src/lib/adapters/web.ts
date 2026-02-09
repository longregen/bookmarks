import type { PlatformAdapter, ApiSettings, Theme } from '../platform';
import { getSettingsFromDb, saveSettingToDb } from './common';
import { THEME_STORAGE_KEY } from '../constants';

export const webAdapter: PlatformAdapter = {
  async getSettings(): Promise<ApiSettings> {
    return getSettingsFromDb();
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
    return saveSettingToDb(key, value);
  },

  getTheme(): Promise<Theme> {
    try {
      const theme = localStorage.getItem(THEME_STORAGE_KEY);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      return Promise.resolve((theme as Theme) || 'auto');
    } catch {
      return Promise.resolve('auto');
    }
  },

  setTheme(theme: Theme): Promise<void> {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return Promise.resolve();
  },
};
