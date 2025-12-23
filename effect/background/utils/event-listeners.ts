/**
 * Utilities for Chrome event listener registration
 * Reduces duplication in event listener setup patterns
 */

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { LoggingService } from '../../services/logging-service';
import { getErrorMessage } from '../../lib/errors';

/**
 * Create a Chrome event listener with standard error handling
 */
export function createChromeEventListener<E extends chrome.events.Event<T>, T extends (...args: any[]) => void>(
  event: E,
  listenerName: string,
  handler: (...args: Parameters<T>) => Effect.Effect<void, unknown, any>,
  layer: Layer.Layer<any, never, never>
): Effect.Effect<() => void, never, LoggingService> {
  return Effect.gen(function* () {
    const logging = yield* LoggingService;

    yield* logging.debug(`Registering ${listenerName} listener`);

    const listener = ((...args: Parameters<T>) => {
      Effect.runPromise(
        handler(...args).pipe(
          Effect.provide(layer),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const logging = yield* LoggingService;
              yield* logging.error(`${listenerName} handler error`, {
                error: getErrorMessage(error),
              });
            }).pipe(Effect.provide(layer))
          )
        )
      ).catch((error) => {
        console.error(`${listenerName} handler error:`, error);
      });
    }) as T;

    event.addListener(listener);

    return Effect.sync(() => {
      event.removeListener(listener);
    });
  });
}

/**
 * Create a simple Chrome event listener that just logs
 */
export function createSimpleChromeEventListener<E extends chrome.events.Event<T>, T extends (...args: any[]) => void>(
  event: E,
  listenerName: string,
  logMessage: string,
  handler: Effect.Effect<void, unknown, any>,
  layer: Layer.Layer<any, never, never>
): Effect.Effect<() => void, never, LoggingService> {
  return createChromeEventListener(
    event,
    listenerName,
    () =>
      Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.info(logMessage);
        yield* handler;
      }),
    layer
  );
}
