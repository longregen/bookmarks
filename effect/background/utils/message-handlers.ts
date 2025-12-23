/**
 * Utilities for message handler registration
 * Reduces duplication in service-worker message listener setup
 */

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { MessagingService } from '../../lib/messages';
import { getErrorMessage } from '../../lib/errors';

/**
 * Creates a message listener with common error handling pattern
 */
export function createMessageHandler<M, R, E, A>(
  messaging: MessagingService,
  messageType: string,
  handler: (msg: M) => Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>,
  errorResponse: (error: E) => A
): Effect.Effect<() => void, never, never> {
  return messaging.addMessageListener(messageType, (msg: M) =>
    handler(msg).pipe(
      Effect.provide(layer),
      Effect.catchAll((error) => Effect.succeed(errorResponse(error)))
    )
  );
}

/**
 * Creates a message listener with standard error response format
 */
export function createStandardMessageHandler<M, R, E>(
  messaging: MessagingService,
  messageType: string,
  handler: (msg: M) => Effect.Effect<{ success: boolean } & Record<string, unknown>, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<() => void, never, never> {
  return createMessageHandler(
    messaging,
    messageType,
    handler,
    layer,
    (error) => ({
      success: false,
      error: getErrorMessage(error),
    })
  );
}

/**
 * Creates a no-arg message listener
 */
export function createNoArgMessageHandler<R, E, A>(
  messaging: MessagingService,
  messageType: string,
  handler: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>,
  errorResponse: (error: E) => A
): Effect.Effect<() => void, never, never> {
  return messaging.addMessageListener(messageType, () =>
    handler.pipe(
      Effect.provide(layer),
      Effect.catchAll((error) => Effect.succeed(errorResponse(error)))
    )
  );
}
