/**
 * Utilities for Chrome API wrapping with Effect
 * Reduces duplication in Chrome API interaction patterns
 */

import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import { getErrorMessage } from '../../lib/errors';

export class ChromeApiError extends Data.TaggedError('ChromeApiError')<{
  readonly operation: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

/**
 * Wrap a Chrome API promise in an Effect with error handling
 */
export function wrapChromePromise<T>(
  operation: string,
  promise: () => Promise<T>
): Effect.Effect<T, ChromeApiError, never> {
  return Effect.tryPromise({
    try: promise,
    catch: (error) =>
      new ChromeApiError({
        operation,
        message: getErrorMessage(error),
        originalError: error,
      }),
  });
}

/**
 * Wrap a Chrome API callback-based function in an Effect
 */
export function wrapChromeCallback<T>(
  operation: string,
  callback: (resume: (result: T) => void) => void
): Effect.Effect<T, ChromeApiError, never> {
  return Effect.async<T, ChromeApiError>((resume) => {
    try {
      callback((result) => resume(Effect.succeed(result)));
    } catch (error) {
      resume(
        Effect.fail(
          new ChromeApiError({
            operation,
            message: getErrorMessage(error),
            originalError: error,
          })
        )
      );
    }
  });
}

/**
 * Wrap a Chrome API void promise in an Effect
 */
export function wrapChromeVoidPromise(
  operation: string,
  promise: () => Promise<unknown>
): Effect.Effect<void, ChromeApiError, never> {
  return wrapChromePromise(operation, promise).pipe(Effect.asVoid);
}
