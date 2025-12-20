import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import type { ApiSettings, Theme } from '../../../src/lib/platform';
import { getSettingsFromDb, saveSettingToDb } from '../../../src/lib/adapters/common';

const THEME_KEY = 'bookmark-rag-theme';

const CORS_PROXIES = [
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

// Error types
export class SettingsError extends Data.TaggedError('SettingsError')<{
  readonly operation: 'get' | 'save';
  readonly message: string;
}> {}

export class ThemeError extends Data.TaggedError('ThemeError')<{
  readonly operation: 'get' | 'set';
  readonly message: string;
}> {}

export class FetchError extends Data.TaggedError('FetchError')<{
  readonly url: string;
  readonly message: string;
  readonly attempts: ReadonlyArray<string>;
}> {}

// Service interface
export class WebPlatformAdapter extends Context.Tag('WebPlatformAdapter')<
  WebPlatformAdapter,
  {
    readonly getSettings: () => Effect.Effect<ApiSettings, SettingsError>;
    readonly saveSetting: (
      key: keyof ApiSettings,
      value: string | boolean | number
    ) => Effect.Effect<void, SettingsError>;
    readonly getTheme: () => Effect.Effect<Theme, ThemeError>;
    readonly setTheme: (theme: Theme) => Effect.Effect<void, ThemeError>;
    readonly fetchContent: (
      url: string
    ) => Effect.Effect<{ html: string; finalUrl: string }, FetchError>;
  }
>() {}

// Layer implementation
export const WebPlatformAdapterLive = Layer.succeed(WebPlatformAdapter, {
  getSettings: () =>
    Effect.tryPromise({
      try: () => getSettingsFromDb(),
      catch: (error) =>
        new SettingsError({
          operation: 'get',
          message: error instanceof Error ? error.message : String(error),
        }),
    }),

  saveSetting: (key, value) =>
    Effect.tryPromise({
      try: () => saveSettingToDb(key, value),
      catch: (error) =>
        new SettingsError({
          operation: 'save',
          message: error instanceof Error ? error.message : String(error),
        }),
    }),

  getTheme: () =>
    Effect.try({
      try: () => {
        const theme = localStorage.getItem(THEME_KEY);
        return (theme as Theme) || 'auto';
      },
      catch: (error) =>
        new ThemeError({
          operation: 'get',
          message: error instanceof Error ? error.message : String(error),
        }),
    }),

  setTheme: (theme) =>
    Effect.try({
      try: () => {
        localStorage.setItem(THEME_KEY, theme);
      },
      catch: (error) =>
        new ThemeError({
          operation: 'set',
          message: error instanceof Error ? error.message : String(error),
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
        new FetchError({
          url,
          message: 'All methods failed (direct fetch and CORS proxies)',
          attempts,
        })
      );
    }),
});
