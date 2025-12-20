/**
 * Debug utilities for logging with compile-time elimination.
 *
 * This module provides Effect-based debug logging that can be completely
 * eliminated at compile time when __DEBUG_EMBEDDINGS__ is false.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';

/**
 * Debug service for logging debug messages.
 * Compiles away to a no-op when __DEBUG_EMBEDDINGS__ is false.
 */
export class DebugService extends Context.Tag('DebugService')<
  DebugService,
  {
    readonly log: (
      prefix: string,
      msg: string,
      data?: unknown
    ) => Effect.Effect<void>;
  }
>() {}

/**
 * Live implementation that logs to console.
 */
const DebugServiceLive: Layer.Layer<DebugService> = makeLayer(
  DebugService,
  {
    log: (prefix: string, msg: string, data?: unknown) =>
      Effect.sync(() => {
        console.log(`[${prefix}] ${msg}`, data);
      }),
  }
);

/**
 * No-op implementation that does nothing.
 */
const DebugServiceNoop: Layer.Layer<DebugService> = makeLayer(
  DebugService,
  {
    log: (_prefix: string, _msg: string, _data?: unknown) => Effect.void,
  }
);

/**
 * Export the appropriate layer based on compile-time constant.
 */
export const DebugServiceLayer = __DEBUG_EMBEDDINGS__
  ? DebugServiceLive
  : DebugServiceNoop;

/**
 * Creates a debug logger with a specific prefix.
 * Returns a function that produces an Effect for logging.
 *
 * @example
 * ```typescript
 * const debug = createDebugLog('MyModule');
 *
 * const program = Effect.gen(function* () {
 *   yield* debug('Something happened', { data: 'value' });
 * });
 * ```
 */
export function createDebugLog(
  prefix: string
): (msg: string, data?: unknown) => Effect.Effect<void, never, DebugService> {
  return (msg: string, data?: unknown) =>
    Effect.gen(function* () {
      const debugService = yield* DebugService;
      yield* debugService.log(prefix, msg, data);
    });
}

/**
 * Execute an effect only when debug mode is enabled.
 * Use this for complex debug logging that involves expensive computations.
 *
 * The effect factory is only called when __DEBUG_EMBEDDINGS__ is true,
 * allowing expensive computations to be completely eliminated.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   yield* debugOnly(() =>
 *     Effect.sync(() => {
 *       const info = expensiveDebugComputation();
 *       console.log('Debug info:', info);
 *     })
 *   );
 * });
 * ```
 */
export function debugOnly<A, E, R>(
  effect: () => Effect.Effect<A, E, R>
): Effect.Effect<void, E, R> {
  if (__DEBUG_EMBEDDINGS__) {
    return Effect.asVoid(effect());
  } else {
    return Effect.void as Effect.Effect<void, E, R>;
  }
}
