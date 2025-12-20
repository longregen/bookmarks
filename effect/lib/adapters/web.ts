import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import type { ApiSettings, Theme } from '../../../src/lib/platform';
import {
  PlatformSettingsError,
  PlatformThemeError,
  PlatformFetchError,
} from '../platform';
import { getSettingsFromDb, saveSettingToDb } from '../../../src/lib/adapters/common';
import {
  THEME_STORAGE_KEY,
  CORS_PROXIES,
  getErrorMessage,
} from './common';

// Service interface
export class WebPlatformAdapter extends Context.Tag('WebPlatformAdapter')<
  WebPlatformAdapter,
  {
    readonly getSettings: () => Effect.Effect<ApiSettings, PlatformSettingsError>;
    readonly saveSetting: (
      key: keyof ApiSettings,
      value: string | boolean | number
    ) => Effect.Effect<void, PlatformSettingsError>;
    readonly getTheme: () => Effect.Effect<Theme, PlatformThemeError>;
    readonly setTheme: (theme: Theme) => Effect.Effect<void, PlatformThemeError>;
    readonly fetchContent: (
      url: string
    ) => Effect.Effect<{ html: string; finalUrl: string }, PlatformFetchError>;
  }
>() {}

// Layer implementation
export const WebPlatformAdapterLive = Layer.succeed(WebPlatformAdapter, {
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
    Effect.try({
      try: () => {
        const theme = localStorage.getItem(THEME_STORAGE_KEY);
        return (theme as Theme) || 'auto';
      },
      catch: (error) =>
        new PlatformThemeError({
          operation: 'get',
          message: 'Failed to get theme from localStorage',
          cause: error,
        }),
    }),

  setTheme: (theme) =>
    Effect.try({
      try: () => {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      },
      catch: (error) =>
        new PlatformThemeError({
          operation: 'set',
          theme,
          message: 'Failed to set theme in localStorage',
          cause: error,
        }),
    }),

  fetchContent: (url) =>
    Effect.gen(function* () {
      // Try direct fetch first
      const directResult = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(url);
          if (response.ok) {
            const html = await response.text();
            return { html, finalUrl: response.url || url, success: true as const };
          }
          return { success: false as const };
        },
        catch: () => ({ success: false as const }),
      });

      if (directResult.success) {
        return { html: directResult.html, finalUrl: directResult.finalUrl };
      }

      // Try CORS proxies
      const attempts: string[] = ['direct'];

      for (const proxy of CORS_PROXIES) {
        const proxyUrl = proxy.format(url);
        attempts.push(proxy.name);

        const proxyResult = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(proxyUrl);
            if (response.ok) {
              const html = await response.text();
              return { html, finalUrl: url, success: true as const };
            }
            return { success: false as const };
          },
          catch: () => ({ success: false as const }),
        });

        if (proxyResult.success) {
          return { html: proxyResult.html, finalUrl: proxyResult.finalUrl };
        }
      }

      // All methods failed
      return yield* Effect.fail(
        new PlatformFetchError({
          url,
          message: `Failed to fetch content: all methods failed (${attempts.join(', ')})`,
          cause: new Error('All methods failed (direct fetch and CORS proxies)'),
        })
      );
    }),
});
