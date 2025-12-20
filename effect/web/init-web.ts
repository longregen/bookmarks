import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Data } from 'effect';
import { setPlatformAdapter } from '../../src/lib/platform';
import { webAdapter } from '../../src/lib/adapters/web';
import { ThemeService, ThemeServiceWeb } from '../shared/theme';

/**
 * Error type for web initialization failures
 */
export class InitializationError extends Data.TaggedError('InitializationError')<{
  readonly reason: 'platform_init_failed' | 'theme_init_failed' | 'unknown';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Service for managing platform adapter initialization
 */
export class PlatformInitService extends Context.Tag('PlatformInitService')<
  PlatformInitService,
  {
    /**
     * Initialize the platform adapter for web environment
     */
    readonly initPlatform: () => Effect.Effect<void, InitializationError, never>;
  }
>() {}

/**
 * Create PlatformInitService implementation
 */
const makePlatformInitService = Effect.sync(() => {
  const initPlatform = (): Effect.Effect<void, InitializationError, never> =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          setPlatformAdapter(webAdapter);
        },
        catch: (error) =>
          new InitializationError({
            reason: 'platform_init_failed',
            message: 'Failed to initialize platform adapter',
            cause: error,
          }),
      });
    });

  return {
    initPlatform,
  };
});

/**
 * Layer providing PlatformInitService
 */
export const PlatformInitServiceLive: Layer.Layer<
  PlatformInitService,
  never,
  never
> = Layer.effect(PlatformInitService, makePlatformInitService);

/**
 * Combined layer for all web initialization services
 */
export const WebInitLive: Layer.Layer<
  PlatformInitService | ThemeService,
  never,
  never
> = Layer.mergeAll(PlatformInitServiceLive, ThemeServiceWeb);

/**
 * Effect-based web initialization
 *
 * Initializes the web platform by:
 * 1. Setting the platform adapter to webAdapter
 * 2. Loading and applying the current theme
 *
 * @returns Effect that performs initialization or fails with InitializationError
 */
export const initWebEffect: Effect.Effect<
  void,
  InitializationError,
  PlatformInitService | ThemeService
> = Effect.gen(function* () {
  const platformService = yield* PlatformInitService;
  const themeService = yield* ThemeService;

  // Initialize platform adapter
  yield* platformService.initPlatform();

  // Initialize theme using ThemeService
  yield* themeService.initTheme.pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new InitializationError({
          reason: 'theme_init_failed',
          message: 'Failed to initialize theme',
          cause: error,
        })
      )
    )
  );
});

/**
 * Legacy async function for backward compatibility
 *
 * Initializes the web platform by setting the platform adapter
 * and initializing the theme.
 *
 * This function maintains the same API as the original implementation
 * while using Effect.ts internally.
 */
export async function initWeb(): Promise<void> {
  const program = initWebEffect.pipe(Effect.provide(WebInitLive));

  await Effect.runPromise(program);
}
