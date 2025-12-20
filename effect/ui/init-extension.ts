import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';

import { setPlatformAdapter } from '../../src/lib/platform';
import { extensionAdapter } from '../../src/lib/adapters/extension';
import { initTheme } from '../../src/shared/theme';

// ============================================================================
// Errors
// ============================================================================

export class InitializationError extends Data.TaggedError('InitializationError')<{
  readonly step: 'platform' | 'theme';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

/**
 * PlatformService manages platform adapter setup for the extension environment.
 */
export class PlatformService extends Context.Tag('PlatformService')<
  PlatformService,
  {
    setup(): Effect.Effect<void, InitializationError, never>;
  }
>() {}

/**
 * ThemeService manages theme initialization for the UI.
 */
export class ThemeService extends Context.Tag('ThemeService')<
  ThemeService,
  {
    init(): Effect.Effect<void, InitializationError, never>;
  }
>() {}

// ============================================================================
// Layers
// ============================================================================

/**
 * Live implementation of PlatformService using the extension adapter.
 */
export const PlatformServiceLive: Layer.Layer<PlatformService, never, never> =
  Layer.succeed(PlatformService, {
    setup: () =>
      Effect.try({
        try: () => setPlatformAdapter(extensionAdapter),
        catch: (error) => new InitializationError({
          step: 'platform',
          message: 'Failed to setup platform adapter',
          cause: error,
        }),
      }),
  });

/**
 * Live implementation of ThemeService.
 */
export const ThemeServiceLive: Layer.Layer<ThemeService, never, never> =
  Layer.succeed(ThemeService, {
    init: () =>
      Effect.tryPromise({
        try: () => initTheme(),
        catch: (error) => new InitializationError({
          step: 'theme',
          message: 'Failed to initialize theme',
          cause: error,
        }),
      }),
  });

/**
 * Combined layer providing all services needed for extension initialization.
 */
export const ExtensionInitLayer = Layer.mergeAll(
  PlatformServiceLive,
  ThemeServiceLive
);

// ============================================================================
// Effects
// ============================================================================

/**
 * Core initialization effect that sets up the extension environment.
 *
 * This effect:
 * 1. Sets up the platform adapter (extension vs web)
 * 2. Initializes the theme (light/dark mode)
 *
 * @returns Effect that completes when initialization is done
 */
export const initExtensionEffect: Effect.Effect<
  void,
  InitializationError,
  PlatformService | ThemeService
> = Effect.gen(function* () {
  const platform = yield* PlatformService;
  const theme = yield* ThemeService;

  yield* platform.setup();
  yield* theme.init();
});

/**
 * Initializes the extension environment with platform adapter and theme.
 *
 * This function maintains compatibility with the original async/await API
 * while using Effect.ts internally for better error handling and composability.
 *
 * @throws {InitializationError} If platform setup or theme initialization fails
 */
export async function initExtension(): Promise<void> {
  const program = initExtensionEffect.pipe(
    Effect.provide(ExtensionInitLayer)
  );

  return Effect.runPromise(program);
}
