import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';

// Type definition
export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

const THEME_STORAGE_KEY = 'bookmark-rag-theme';

// Typed errors
export class ThemeError extends Data.TaggedError('ThemeError')<{
  operation: 'get' | 'set' | 'apply' | 'listen';
  message: string;
  cause?: unknown;
}> {}

// Service definition
export class ThemeService extends Context.Tag('ThemeService')<
  ThemeService,
  {
    readonly getTheme: Effect.Effect<Theme, ThemeError>;
    readonly setTheme: (theme: Theme) => Effect.Effect<void, ThemeError>;
    readonly applyTheme: (theme: Theme) => Effect.Effect<void, never>;
    readonly initTheme: Effect.Effect<void, ThemeError>;
    readonly onThemeChange: (
      callback: (theme: Theme) => void
    ) => Effect.Effect<() => void, never>;
  }
>() {}

// Helper to apply theme to DOM (synchronous side effect)
const applyThemeToDOM = (theme: Theme): Effect.Effect<void, never> =>
  Effect.sync(() => {
    const root = document.documentElement;
    root.removeAttribute('data-theme');

    if (theme !== 'auto') {
      root.setAttribute('data-theme', theme);
    }
  });

// Web implementation (uses localStorage)
export const ThemeServiceWeb: Layer.Layer<ThemeService, never> = Layer.succeed(
  ThemeService,
  {
    getTheme: Effect.tryPromise({
      try: async () => {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return (stored as Theme | null) ?? 'auto';
      },
      catch: (error) =>
        new ThemeError({
          operation: 'get',
          message: 'Failed to get theme from localStorage',
          cause: error,
        }),
    }),

    setTheme: (theme: Theme) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
          },
          catch: (error) =>
            new ThemeError({
              operation: 'set',
              message: 'Failed to set theme in localStorage',
              cause: error,
            }),
        });

        yield* applyThemeToDOM(theme);
      }),

    applyTheme: applyThemeToDOM,

    initTheme: Effect.gen(function* () {
      const theme = yield* Effect.tryPromise({
        try: async () => {
          const stored = localStorage.getItem(THEME_STORAGE_KEY);
          return (stored as Theme | null) ?? 'auto';
        },
        catch: (error) =>
          new ThemeError({
            operation: 'get',
            message: 'Failed to get theme from localStorage',
            cause: error,
          }),
      });

      yield* applyThemeToDOM(theme);
    }),

    onThemeChange: (callback: (theme: Theme) => void) =>
      Effect.sync(() => {
        const handler = (event: StorageEvent): void => {
          if (
            event.key === THEME_STORAGE_KEY &&
            event.newValue !== null &&
            event.newValue !== ''
          ) {
            callback(event.newValue as Theme);
          }
        };

        window.addEventListener('storage', handler);

        // Return cleanup function
        return () => {
          window.removeEventListener('storage', handler);
        };
      }),
  }
);

// Extension implementation (uses chrome.storage.local)
export const ThemeServiceExtension: Layer.Layer<ThemeService, never> =
  Layer.succeed(ThemeService, {
    getTheme: Effect.tryPromise({
      try: async () => {
        const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
        return (result[THEME_STORAGE_KEY] as Theme | undefined) ?? 'auto';
      },
      catch: (error) =>
        new ThemeError({
          operation: 'get',
          message: 'Failed to get theme from chrome.storage',
          cause: error,
        }),
    }),

    setTheme: (theme: Theme) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
          },
          catch: (error) =>
            new ThemeError({
              operation: 'set',
              message: 'Failed to set theme in chrome.storage',
              cause: error,
            }),
        });

        yield* applyThemeToDOM(theme);
      }),

    applyTheme: applyThemeToDOM,

    initTheme: Effect.gen(function* () {
      const theme = yield* Effect.tryPromise({
        try: async () => {
          const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
          return (result[THEME_STORAGE_KEY] as Theme | undefined) ?? 'auto';
        },
        catch: (error) =>
          new ThemeError({
            operation: 'get',
            message: 'Failed to get theme from chrome.storage',
            cause: error,
          }),
      });

      yield* applyThemeToDOM(theme);
    }),

    onThemeChange: (callback: (theme: Theme) => void) =>
      Effect.sync(() => {
        const handler = (
          changes: {
            [key: string]: chrome.storage.StorageChange;
          },
          areaName: string
        ): void => {
          if (areaName === 'local' && THEME_STORAGE_KEY in changes) {
            const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme;
            callback(newTheme);
          }
        };

        chrome.storage.onChanged.addListener(handler);

        // Return cleanup function
        return () => {
          chrome.storage.onChanged.removeListener(handler);
        };
      }),
  });

// Public API functions (for backwards compatibility)
// These will need the ThemeService to be provided via Layer

export const getTheme = (): Effect.Effect<Theme, ThemeError, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    return yield* service.getTheme;
  });

export const setTheme = (
  theme: Theme
): Effect.Effect<void, ThemeError, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    return yield* service.setTheme(theme);
  });

export const applyTheme = (
  theme: Theme
): Effect.Effect<void, never, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    return yield* service.applyTheme(theme);
  });

export const initTheme = (): Effect.Effect<void, ThemeError, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    return yield* service.initTheme;
  });

export const onThemeChange = (
  callback: (theme: Theme) => void
): Effect.Effect<() => void, never, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    return yield* service.onThemeChange(callback);
  });

// Resource-safe theme change listener with automatic cleanup
export const withThemeChangeListener = <A, E>(
  callback: (theme: Theme) => void,
  effect: Effect.Effect<A, E, ThemeService>
): Effect.Effect<A, E, ThemeService> =>
  Effect.gen(function* () {
    const service = yield* ThemeService;
    const cleanup = yield* service.onThemeChange(callback);

    try {
      return yield* effect;
    } finally {
      cleanup();
    }
  });
