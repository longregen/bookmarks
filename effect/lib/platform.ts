import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
  webdavEnabled: boolean;
  webdavAllowInsecure: boolean;
  webdavSyncInterval: number;
  webdavLastSyncTime: string;
  webdavLastSyncError: string;
}

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

// ============================================================================
// Typed Errors
// ============================================================================

export class PlatformSettingsError extends Data.TaggedError('PlatformSettingsError')<{
  operation: 'get' | 'save';
  key?: keyof ApiSettings;
  message: string;
  cause?: unknown;
}> {}

export class PlatformThemeError extends Data.TaggedError('PlatformThemeError')<{
  operation: 'get' | 'set';
  theme?: Theme;
  message: string;
  cause?: unknown;
}> {}

export class PlatformFetchError extends Data.TaggedError('PlatformFetchError')<{
  url: string;
  message: string;
  cause?: unknown;
}> {}

export class PlatformNotInitializedError extends Data.TaggedError('PlatformNotInitializedError')<{
  message: string;
}> {}

// ============================================================================
// Service Definition
// ============================================================================

export class PlatformService extends Context.Tag('PlatformService')<
  PlatformService,
  {
    getSettings(): Effect.Effect<ApiSettings, PlatformSettingsError, never>;
    saveSetting(
      key: keyof ApiSettings,
      value: string | boolean | number
    ): Effect.Effect<void, PlatformSettingsError, never>;
    getTheme(): Effect.Effect<Theme, PlatformThemeError, never>;
    setTheme(theme: Theme): Effect.Effect<void, PlatformThemeError, never>;
    fetchContent(url: string): Effect.Effect<
      { html: string; finalUrl: string } | null,
      PlatformFetchError,
      never
    >;
  }
>() {}

// ============================================================================
// Legacy Adapter Interface (for compatibility)
// ============================================================================

export interface PlatformAdapter {
  getSettings(): Promise<ApiSettings>;
  saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void>;
  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;
  fetchContent?(url: string): Promise<{ html: string; finalUrl: string }>;
}

// ============================================================================
// Layer Factory
// ============================================================================

/**
 * Creates a PlatformService Layer from a legacy PlatformAdapter.
 * This allows gradual migration from the old Promise-based API to Effect.
 */
export function makePlatformLayer(
  adapter: PlatformAdapter
): Layer.Layer<PlatformService, never, never> {
  return Layer.succeed(PlatformService, {
    getSettings: () =>
      Effect.tryPromise({
        try: () => adapter.getSettings(),
        catch: (error) =>
          new PlatformSettingsError({
            operation: 'get',
            message: 'Failed to get settings',
            cause: error,
          }),
      }),

    saveSetting: (key, value) =>
      Effect.tryPromise({
        try: () => adapter.saveSetting(key, value),
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
        try: () => adapter.getTheme(),
        catch: (error) =>
          new PlatformThemeError({
            operation: 'get',
            message: 'Failed to get theme',
            cause: error,
          }),
      }),

    setTheme: (theme) =>
      Effect.tryPromise({
        try: () => adapter.setTheme(theme),
        catch: (error) =>
          new PlatformThemeError({
            operation: 'set',
            theme,
            message: `Failed to set theme: ${theme}`,
            cause: error,
          }),
      }),

    fetchContent: (url) =>
      adapter.fetchContent
        ? Effect.tryPromise({
            try: () => adapter.fetchContent!(url),
            catch: (error) =>
              new PlatformFetchError({
                url,
                message: `Failed to fetch content from: ${url}`,
                cause: error,
              }),
          })
        : Effect.succeed(null),
  });
}

// ============================================================================
// Effect-based Helper Functions
// ============================================================================

/**
 * Gets platform settings from the PlatformService context.
 */
export const getSettings = (): Effect.Effect<
  ApiSettings,
  PlatformSettingsError,
  PlatformService
> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    return yield* platform.getSettings();
  });

/**
 * Saves a single setting to the platform storage.
 */
export const saveSetting = (
  key: keyof ApiSettings,
  value: string | boolean | number
): Effect.Effect<void, PlatformSettingsError, PlatformService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    return yield* platform.saveSetting(key, value);
  });

/**
 * Gets the current theme from platform storage.
 */
export const getTheme = (): Effect.Effect<Theme, PlatformThemeError, PlatformService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    return yield* platform.getTheme();
  });

/**
 * Sets the theme in platform storage.
 */
export const setTheme = (theme: Theme): Effect.Effect<void, PlatformThemeError, PlatformService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    return yield* platform.setTheme(theme);
  });

/**
 * Fetches content from a URL using platform-specific fetch implementation.
 * Returns null if the platform adapter doesn't support content fetching.
 */
export const fetchContent = (
  url: string
): Effect.Effect<{ html: string; finalUrl: string } | null, PlatformFetchError, PlatformService> =>
  Effect.gen(function* () {
    const platform = yield* PlatformService;
    return yield* platform.fetchContent(url);
  });

// ============================================================================
// Legacy Compatibility Layer (deprecated, use Effect-based API)
// ============================================================================

let adapter: PlatformAdapter | null = null;

/**
 * @deprecated Use makePlatformLayer and provide via Layer instead
 */
export function setPlatformAdapter(a: PlatformAdapter): void {
  adapter = a;
}

/**
 * @deprecated Use PlatformService from Effect context instead
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (!adapter) {
    throw new Error('Platform adapter not initialized. Call setPlatformAdapter() first.');
  }
  return adapter;
}
