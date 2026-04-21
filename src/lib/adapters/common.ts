import { db } from '../../db/schema';
import type { ApiSettings, ContentTier } from '../platform';
import { config } from '../config-registry';

export const DEFAULTS: ApiSettings = {
  apiBaseUrl: config.DEFAULT_API_BASE_URL,
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  serverUrl: '',
  serverEnabled: false,
  serverSessionToken: '',
  serverSessionExpiry: '',
  serverAuthToken: '',
  serverLastSyncTime: '',
  serverLastSyncError: '',
  contentTier: 'full',
  markdownCacheCapMB: 50,
  markdownCacheBytes: 0,
  contentTierMigrationAt: '',
  loadExternalResources: true,
};

export async function getSettingsFromDb(): Promise<ApiSettings> {
  const rows = await db.settings.toArray();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, string | boolean | number | undefined>;

  return {
    apiBaseUrl: (map.apiBaseUrl as string | undefined) ?? DEFAULTS.apiBaseUrl,
    apiKey: (map.apiKey as string | undefined) ?? DEFAULTS.apiKey,
    chatModel: (map.chatModel as string | undefined) ?? DEFAULTS.chatModel,
    embeddingModel: (map.embeddingModel as string | undefined) ?? DEFAULTS.embeddingModel,
    serverUrl: (map.serverUrl as string | undefined) ?? DEFAULTS.serverUrl,
    serverEnabled: (map.serverEnabled as boolean | undefined) ?? DEFAULTS.serverEnabled,
    serverSessionToken: (map.serverSessionToken as string | undefined) ?? DEFAULTS.serverSessionToken,
    serverSessionExpiry: (map.serverSessionExpiry as string | undefined) ?? DEFAULTS.serverSessionExpiry,
    serverAuthToken: (map.serverAuthToken as string | undefined) ?? DEFAULTS.serverAuthToken,
    serverLastSyncTime: (map.serverLastSyncTime as string | undefined) ?? DEFAULTS.serverLastSyncTime,
    serverLastSyncError: (map.serverLastSyncError as string | undefined) ?? DEFAULTS.serverLastSyncError,
    contentTier: normalizeContentTier(map.contentTier),
    markdownCacheCapMB: (map.markdownCacheCapMB as number | undefined) ?? DEFAULTS.markdownCacheCapMB,
    markdownCacheBytes: (map.markdownCacheBytes as number | undefined) ?? DEFAULTS.markdownCacheBytes,
    contentTierMigrationAt: (map.contentTierMigrationAt as string | undefined) ?? DEFAULTS.contentTierMigrationAt,
    loadExternalResources: (map.loadExternalResources as boolean | undefined) ?? DEFAULTS.loadExternalResources,
  };
}

function normalizeContentTier(raw: unknown): ContentTier {
  return raw === 'summaries' || raw === 'titles' ? raw : 'full';
}

export async function saveSettingToDb(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
  const now = new Date();
  const existing = await db.settings.get(key);

  if (existing) {
    await db.settings.update(key, { value, updatedAt: now });
  } else {
    await db.settings.add({ key, value, createdAt: now, updatedAt: now });
  }
}
