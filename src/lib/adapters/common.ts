import { db } from '../../db/schema';
import type { ApiSettings } from '../platform';
import { config } from '../config-registry';

/**
 * Shared defaults for API settings across all platform adapters
 */
export const DEFAULTS: ApiSettings = {
  apiBaseUrl: config.DEFAULT_API_BASE_URL,
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavPath: '/bookmarks',
  webdavEnabled: false,
  webdavAllowInsecure: false,
  webdavSyncInterval: 15,
  webdavLastSyncTime: '',
  webdavLastSyncError: '',
};

/**
 * Shared function to get settings from IndexedDB
 * Used by both extension and web adapters
 */
export async function getSettingsFromDb(): Promise<ApiSettings> {
  const rows = await db.settings.toArray();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    apiBaseUrl: map.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    apiKey: map.apiKey ?? DEFAULTS.apiKey,
    chatModel: map.chatModel ?? DEFAULTS.chatModel,
    embeddingModel: map.embeddingModel ?? DEFAULTS.embeddingModel,
    webdavUrl: map.webdavUrl ?? DEFAULTS.webdavUrl,
    webdavUsername: map.webdavUsername ?? DEFAULTS.webdavUsername,
    webdavPassword: map.webdavPassword ?? DEFAULTS.webdavPassword,
    webdavPath: map.webdavPath ?? DEFAULTS.webdavPath,
    webdavEnabled: map.webdavEnabled ?? DEFAULTS.webdavEnabled,
    webdavAllowInsecure: map.webdavAllowInsecure ?? DEFAULTS.webdavAllowInsecure,
    webdavSyncInterval: map.webdavSyncInterval ?? DEFAULTS.webdavSyncInterval,
    webdavLastSyncTime: map.webdavLastSyncTime ?? DEFAULTS.webdavLastSyncTime,
    webdavLastSyncError: map.webdavLastSyncError ?? DEFAULTS.webdavLastSyncError,
  };
}

/**
 * Shared function to save a setting to IndexedDB
 * Used by both extension and web adapters
 */
export async function saveSettingToDb(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
  const now = new Date();
  const existing = await db.settings.get(key);

  if (existing) {
    await db.settings.update(key, { value, updatedAt: now });
  } else {
    await db.settings.add({ key, value, createdAt: now, updatedAt: now });
  }
}
