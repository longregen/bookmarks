import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { onThemeChange, applyTheme, getTheme, setTheme, type Theme } from '../../shared/theme';
import { initExtension } from '../../ui/init-extension';
import { initWeb } from '../../web/init-web';

// Error types
export class ThemeError extends Data.TaggedError('ThemeError')<{
  readonly reason: 'dom_not_found' | 'load_failed' | 'set_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ThemeService definition
export class ThemeService extends Context.Tag('ThemeService')<
  ThemeService,
  {
    loadTheme(): Effect.Effect<void, ThemeError, never>;
    setupThemeListeners(): Effect.Effect<void, ThemeError, never>;
    initThemeModule(): Effect.Effect<void, ThemeError, never>;
  }
>() {}

// Implementation
const makeThemeService = Effect.sync(() => {
  const loadTheme = (): Effect.Effect<void, ThemeError, never> =>
    Effect.gen(function* () {
      const theme = yield* Effect.tryPromise({
        try: () => getTheme(),
        catch: (error) =>
          new ThemeError({
            reason: 'load_failed',
            message: 'Failed to load theme',
            cause: error,
          }),
      });

      const radio = yield* Effect.sync(() =>
        document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`)
      );

      if (radio) {
        yield* Effect.sync(() => {
          radio.checked = true;
        });
      }
    });

  const setupThemeListeners = (): Effect.Effect<void, ThemeError, never> =>
    Effect.gen(function* () {
      const themeRadios = yield* Effect.sync(() =>
        document.querySelectorAll<HTMLInputElement>('input[name="theme"]')
      );

      for (const radio of Array.from(themeRadios)) {
        const listener = (e: Event): void => {
          const target = e.target as HTMLInputElement;
          if (target.checked) {
            void setTheme(target.value as Theme);
          }
        };

        yield* Effect.sync(() => {
          radio.addEventListener('change', listener);
        });
      }
    });

  const initThemeModule = (): Effect.Effect<void, ThemeError, never> =>
    Effect.gen(function* () {
      // Initialize platform-specific code
      yield* Effect.sync(() => {
        if (__IS_WEB__) {
          void initWeb();
        } else {
          void initExtension();
        }
      });

      // Set up theme change listener (from shared/theme)
      yield* Effect.sync(() => {
        onThemeChange((theme) => applyTheme(theme));
      });

      // Set up radio button listeners
      yield* setupThemeListeners();

      // Load current theme
      yield* loadTheme();
    });

  return {
    loadTheme,
    setupThemeListeners,
    initThemeModule,
  };
});

// Layer
export const ThemeServiceLive: Layer.Layer<ThemeService, never, never> = Layer.effect(
  ThemeService,
  makeThemeService
);

// Legacy export for backward compatibility
export function initThemeModule(): void {
  const program = Effect.gen(function* () {
    const service = yield* ThemeService;
    yield* service.initThemeModule();
  });

  Effect.runPromise(program.pipe(Effect.provide(ThemeServiceLive))).catch((error) => {
    console.error('Failed to initialize theme module:', error);
  });
}
