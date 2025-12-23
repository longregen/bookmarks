import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import type { ApiSettings } from '../platform';
import { config } from '../config-registry';
import { StorageService, type StorageError } from '../../services/storage-service';

/**
 * Shared theme storage key for both extension and web adapters
 */
export const THEME_STORAGE_KEY = 'bookmark-rag-theme';

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * CORS proxy configuration for web environments
 */
export const CORS_PROXIES = [
  {
    name: 'corsproxy.io',
    format: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  },
  {
    name: 'allorigins',
    format: (url: string) =>
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
];

/**
 * ConfigError - Typed error for configuration operations
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  operation: 'read' | 'write' | 'get';
  key?: string;
  message: string;
  cause?: unknown;
}> {}

/**
 * Default API settings
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
 * ConfigService - Service for managing application configuration
 */
export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    /**
     * Get all settings from storage, with defaults applied
     */
    getSettings(): Effect.Effect<ApiSettings, ConfigError, never>;

    /**
     * Save a single setting to storage
     */
    saveSetting(
      key: keyof ApiSettings,
      value: string | boolean | number
    ): Effect.Effect<void, ConfigError, never>;

    /**
     * Get a single setting value
     */
    getSetting<K extends keyof ApiSettings>(
      key: K
    ): Effect.Effect<ApiSettings[K], ConfigError, never>;
  }
>() {}

/**
 * Setting record type as stored in database
 */
interface SettingRecord {
  key: string;
  value: string | boolean | number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Helper function to build settings from a key-value map
 */
function buildSettingsFromMap(
  map: Record<string, string | boolean | number | undefined>
): ApiSettings {
  return {
    apiBaseUrl: (map.apiBaseUrl as string | undefined) ?? DEFAULTS.apiBaseUrl,
    apiKey: (map.apiKey as string | undefined) ?? DEFAULTS.apiKey,
    chatModel: (map.chatModel as string | undefined) ?? DEFAULTS.chatModel,
    embeddingModel: (map.embeddingModel as string | undefined) ?? DEFAULTS.embeddingModel,
    webdavUrl: (map.webdavUrl as string | undefined) ?? DEFAULTS.webdavUrl,
    webdavUsername: (map.webdavUsername as string | undefined) ?? DEFAULTS.webdavUsername,
    webdavPassword: (map.webdavPassword as string | undefined) ?? DEFAULTS.webdavPassword,
    webdavPath: (map.webdavPath as string | undefined) ?? DEFAULTS.webdavPath,
    webdavEnabled: (map.webdavEnabled as boolean | undefined) ?? DEFAULTS.webdavEnabled,
    webdavAllowInsecure: (map.webdavAllowInsecure as boolean | undefined) ?? DEFAULTS.webdavAllowInsecure,
    webdavSyncInterval: (map.webdavSyncInterval as number | undefined) ?? DEFAULTS.webdavSyncInterval,
    webdavLastSyncTime: (map.webdavLastSyncTime as string | undefined) ?? DEFAULTS.webdavLastSyncTime,
    webdavLastSyncError: (map.webdavLastSyncError as string | undefined) ?? DEFAULTS.webdavLastSyncError,
  };
}

/**
 * Create ConfigService implementation
 */
export const makeConfigService = Effect.gen(function* () {
  const storage = yield* StorageService;

  return ConfigService.of({
    getSettings: () =>
      Effect.gen(function* () {
        const rows = yield* storage.query<SettingRecord>('settings', {});

        const map = Object.fromEntries(
          rows.map(r => [r.key, r.value])
        ) as Record<string, string | boolean | number | undefined>;

        return buildSettingsFromMap(map);
      }).pipe(
        Effect.catchTags({
          StorageError: (error) =>
            Effect.fail(
              new ConfigError({
                operation: 'read',
                message: 'Failed to read settings from storage',
                cause: error,
              })
            ),
        })
      ),

    saveSetting: (key: keyof ApiSettings, value: string | boolean | number) =>
      Effect.gen(function* () {
        const now = yield* Effect.sync(() => new Date());
        const existing = yield* storage.get<SettingRecord>('settings', key);

        if (existing) {
          yield* storage.put('settings', key, {
            ...existing,
            value,
            updatedAt: now,
          });
        } else {
          yield* storage.put('settings', key, {
            key,
            value,
            createdAt: now,
            updatedAt: now,
          });
        }
      }).pipe(
        Effect.catchTags({
          StorageError: (error) =>
            Effect.fail(
              new ConfigError({
                operation: 'write',
                key,
                message: `Failed to save setting ${key}`,
                cause: error,
              })
            ),
        })
      ),

    getSetting: <K extends keyof ApiSettings>(key: K) =>
      Effect.gen(function* () {
        const rows = yield* storage.query<SettingRecord>('settings', {});
        const map = Object.fromEntries(
          rows.map(r => [r.key, r.value])
        ) as Record<string, string | boolean | number | undefined>;

        const settings = buildSettingsFromMap(map);
        return settings[key];
      }).pipe(
        Effect.catchTags({
          StorageError: (error) =>
            Effect.fail(
              new ConfigError({
                operation: 'get',
                key,
                message: `Failed to get setting ${key}`,
                cause: error,
              })
            ),
        })
      ),
  });
});

/**
 * Live layer for ConfigService
 * Requires: StorageService
 */
export const ConfigServiceLive: Layer.Layer<
  ConfigService,
  never,
  StorageService
> = Layer.effect(ConfigService, makeConfigService);

/**
 * Compatibility functions for gradual migration from async/await
 * These wrap the Effect-based service for use in non-Effect code
 */

/**
 * Get all settings from database (compatibility wrapper)
 * @deprecated Use ConfigService.getSettings() instead
 */
export function getSettingsFromDb(): Effect.Effect<
  ApiSettings,
  ConfigError,
  ConfigService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    return yield* configService.getSettings();
  });
}

/**
 * Save a setting to database (compatibility wrapper)
 * @deprecated Use ConfigService.saveSetting() instead
 */
export function saveSettingToDb(
  key: keyof ApiSettings,
  value: string | boolean | number
): Effect.Effect<void, ConfigError, ConfigService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    return yield* configService.saveSetting(key, value);
  });
}
