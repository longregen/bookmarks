import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { getPlatformAdapter, type ApiSettings } from '../../src/lib/platform';

export type { ApiSettings };

/**
 * Typed error for settings operations
 */
export class SettingsError extends Data.TaggedError('SettingsError')<{
  readonly operation: 'read' | 'write';
  readonly key?: keyof ApiSettings;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Settings service definition
 */
export class SettingsService extends Context.Tag('SettingsService')<
  SettingsService,
  {
    readonly getSettings: () => Effect.Effect<ApiSettings, SettingsError, never>;
    readonly saveSetting: (
      key: keyof ApiSettings,
      value: string | boolean | number
    ) => Effect.Effect<void, SettingsError, never>;
  }
>() {}

/**
 * Live implementation using platform adapter
 */
export const SettingsServiceLive: Layer.Layer<SettingsService, never, never> =
  Layer.succeed(SettingsService, {
    getSettings: () =>
      Effect.tryPromise({
        try: () => getPlatformAdapter().getSettings(),
        catch: (error) =>
          new SettingsError({
            operation: 'read',
            message: 'Failed to get settings',
            cause: error,
          }),
      }),

    saveSetting: (key, value) =>
      Effect.tryPromise({
        try: () => getPlatformAdapter().saveSetting(key, value),
        catch: (error) =>
          new SettingsError({
            operation: 'write',
            key,
            message: `Failed to save setting: ${key}`,
            cause: error,
          }),
      }),
  });

/**
 * Get all settings
 */
export function getSettings(): Effect.Effect<
  ApiSettings,
  SettingsError,
  SettingsService
> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    return yield* settingsService.getSettings();
  });
}

/**
 * Save a single setting
 */
export function saveSetting(
  key: keyof ApiSettings,
  value: string | boolean | number
): Effect.Effect<void, SettingsError, SettingsService> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;
    return yield* settingsService.saveSetting(key, value);
  });
}

/**
 * Batch update multiple settings
 */
export function saveSettings(
  updates: Partial<ApiSettings>
): Effect.Effect<void, SettingsError, SettingsService> {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService;

    yield* Effect.all(
      Object.entries(updates).map(([key, value]) =>
        settingsService.saveSetting(
          key as keyof ApiSettings,
          value as string | boolean | number
        )
      ),
      { concurrency: 'unbounded' }
    );
  });
}

/**
 * Get a specific setting with type safety
 */
export function getSetting<K extends keyof ApiSettings>(
  key: K
): Effect.Effect<ApiSettings[K], SettingsError, SettingsService> {
  return Effect.gen(function* () {
    const settings = yield* getSettings();
    return settings[key];
  });
}

/**
 * Update a setting with validation
 */
export function updateSetting<K extends keyof ApiSettings>(
  key: K,
  updater: (current: ApiSettings[K]) => ApiSettings[K]
): Effect.Effect<void, SettingsError, SettingsService> {
  return Effect.gen(function* () {
    const current = yield* getSetting(key);
    const updated = yield* Effect.sync(() => updater(current));
    yield* saveSetting(key, updated as string | boolean | number);
  });
}
