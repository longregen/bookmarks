import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';
import {
  PlatformService,
  PlatformSettingsError,
  PlatformThemeError,
  type ApiSettings,
  type Theme,
} from '../platform';
import { getSettingsFromDb, saveSettingToDb } from '../../../src/lib/adapters/common';
import { THEME_STORAGE_KEY } from './common';

/**
 * Platform service Layer for Chrome/Edge extension environment.
 *
 * Provides:
 * - Settings management via IndexedDB (through Dexie)
 * - Theme persistence via chrome.storage.local
 *
 * This layer can be composed with other service layers to create the
 * complete runtime environment for the extension.
 *
 * @example
 * ```typescript
 * const AppLayer = Layer.mergeAll(
 *   ExtensionPlatformLive,
 *   StorageLayerLive,
 *   LoggingLayerLive
 * );
 *
 * const program = Effect.gen(function* () {
 *   const platform = yield* PlatformService;
 *   const settings = yield* platform.getSettings();
 *   console.log('API Key:', settings.apiKey);
 * });
 *
 * Effect.runPromise(Effect.provide(program, AppLayer));
 * ```
 */
export const ExtensionPlatformLive: Layer.Layer<PlatformService, never, never> =
  makeLayer(PlatformService, {
    getSettings: () =>
      Effect.tryPromise({
        try: () => getSettingsFromDb(),
        catch: (error) =>
          new PlatformSettingsError({
            operation: 'get',
            message: 'Failed to get settings from database',
            cause: error,
          }),
      }),

    saveSetting: (key, value) =>
      Effect.tryPromise({
        try: () => saveSettingToDb(key, value),
        catch: (error) =>
          new PlatformSettingsError({
            operation: 'save',
            key,
            message: `Failed to save setting: ${key}`,
            cause: error,
          }),
      }),

    getTheme: () =>
      Effect.tryPromise({
        try: async () => {
          const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
          return (result[THEME_STORAGE_KEY] as Theme) || 'auto';
        },
        catch: (error) =>
          new PlatformThemeError({
            operation: 'get',
            message: 'Failed to get theme from Chrome storage',
            cause: error,
          }),
      }).pipe(
        // Fallback to 'auto' theme on any error
        Effect.catchAll(() => Effect.succeed('auto' as Theme))
      ),

    setTheme: (theme) =>
      Effect.tryPromise({
        try: () => chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme }),
        catch: (error) =>
          new PlatformThemeError({
            operation: 'set',
            theme,
            message: 'Failed to set theme in Chrome storage',
            cause: error,
          }),
      }),

    fetchContent: () =>
      // Extension adapter doesn't support direct content fetching.
      // Content fetching is handled by background scripts via message passing.
      // Returns null to indicate this capability is not available.
      Effect.succeed(null),
  });

/**
 * Legacy adapter export for backwards compatibility with existing code.
 *
 * @deprecated Use ExtensionPlatformLive Layer with Effect-based API instead.
 *
 * This adapter maintains the original Promise-based API to allow gradual
 * migration to Effect.ts. New code should use the Layer-based approach.
 *
 * @example
 * ```typescript
 * // Old way (deprecated):
 * const settings = await extensionAdapter.getSettings();
 *
 * // New way (preferred):
 * const program = Effect.gen(function* () {
 *   const platform = yield* PlatformService;
 *   return yield* platform.getSettings();
 * });
 * const settings = await Effect.runPromise(
 *   Effect.provide(program, ExtensionPlatformLive)
 * );
 * ```
 */
export const extensionAdapter = {
  async getSettings(): Promise<ApiSettings> {
    return getSettingsFromDb();
  },

  async saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
    return saveSettingToDb(key, value);
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
