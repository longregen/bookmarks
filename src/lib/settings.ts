import { db } from '../db/schema';

export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  // WebDAV fields
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
  webdavEnabled: boolean;
}

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

export async function getSettings(): Promise<ApiSettings> {
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
}

export async function saveSetting(key: keyof ApiSettings, value: string | boolean): Promise<void> {
  const now = new Date();
  const existing = await db.settings.get(key);

  if (existing) {
    await db.settings.update(key, { value, updatedAt: now });
  } else {
    await db.settings.add({ key, value, createdAt: now, updatedAt: now });
  }
}
