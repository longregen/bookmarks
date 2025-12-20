import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';

/**
 * Common Effect utilities to reduce boilerplate across the codebase
 */

/**
 * Helper to create Effect.tryPromise with consistent error handling
 */
export function tryPromiseWithError<A, E extends Data.TaggedError<string, any>>(
  promise: () => Promise<A>,
  onError: (error: unknown) => E
): Effect.Effect<A, E, never> {
  return Effect.tryPromise({
    try: promise,
    catch: onError,
  });
}

/**
 * Helper to access a service and call a method on it
 * Reduces the common pattern: Effect.gen(function* () { const service = yield* Service; return yield* service.method(); })
 */
export function accessService<S, A, E, R>(
  tag: Context.Tag<S, any>,
  fn: (service: S) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | S> {
  return Effect.flatMap(tag, fn);
}

/**
 * Helper to map errors from one type to another
 */
export function mapErrorType<A, E1, E2, R>(
  effect: Effect.Effect<A, E1, R>,
  mapper: (error: E1) => E2
): Effect.Effect<A, E2, R> {
  return Effect.mapError(effect, mapper);
}

/**
 * Create a simple Layer using Layer.succeed with less boilerplate
 */
export function makeLayer<I, S>(
  tag: Context.Tag<I, S>,
  implementation: S
): Layer.Layer<I, never, never> {
  return Layer.succeed(tag, implementation);
}

/**
 * Create an effectful Layer using Layer.effect with less boilerplate
 */
export function makeEffectLayer<I, S, E, R>(
  tag: Context.Tag<I, S>,
  effect: Effect.Effect<S, E, R>
): Layer.Layer<I, E, R> {
  return Layer.effect(tag, effect);
}

/**
 * Group items by key into a Map
 * Common pattern for grouping tags, QA pairs, etc.
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

/**
 * Batch get from a Map by keys
 */
export function batchMapGet<K, V>(
  map: Map<K, V>,
  keys: K[],
  defaultValue: V
): Map<K, V> {
  const result = new Map<K, V>();
  for (const key of keys) {
    result.set(key, map.get(key) ?? defaultValue);
  }
  return result;
}

/**
 * Run an Effect with a provided Layer and return a Promise
 * Common pattern for UI integration
 */
export function runWithLayer<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, layer));
}

/**
 * Create error from unknown with message
 */
export function createErrorWithMessage<E extends Data.TaggedError<string, any>>(
  ErrorClass: new (args: any) => E,
  operation: string,
  message: string,
  cause?: unknown
): E {
  return new ErrorClass({
    operation,
    message,
    cause,
  } as any);
}
