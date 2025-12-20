import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Schedule from 'effect/Schedule';
import * as Fiber from 'effect/Fiber';
import * as Ref from 'effect/Ref';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';

/**
 * Typed error for poller failures
 */
export class PollerError extends Data.TaggedError('PollerError')<{
  readonly reason: 'callback_failed' | 'start_failed' | 'stop_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Poller interface providing start/stop operations as Effects
 */
export interface Poller {
  readonly start: Effect.Effect<void, never, never>;
  readonly stop: Effect.Effect<void, never, never>;
}

/**
 * Options for configuring poller behavior
 */
export interface PollerOptions {
  readonly immediate?: boolean;
}

/**
 * Logging service for error reporting
 */
export class LoggingService extends Context.Tag('LoggingService')<
  LoggingService,
  {
    readonly debug: (message: string) => Effect.Effect<void, never, never>;
    readonly error: (message: string, error?: unknown) => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Console-based logging implementation
 */
export const ConsoleLoggingLayer: Layer.Layer<LoggingService> = Layer.succeed(
  LoggingService,
  {
    debug: (message: string) =>
      Effect.sync(() => {
        console.log(message);
      }),
    error: (message: string, error?: unknown) =>
      Effect.sync(() => {
        console.error(message, error);
      }),
  }
);

/**
 * Creates a poller that executes a callback at regular intervals.
 *
 * The poller:
 * - Uses Effect.fork to run the callback in a managed fiber
 * - Uses Schedule.spaced for interval-based repetition
 * - Guarantees cleanup via Fiber.interrupt
 * - Catches and logs callback errors without stopping the poller
 * - Optionally integrates with LoggingService for error reporting
 *
 * @param callback - Effect to execute on each interval
 * @param intervalMs - Time between executions in milliseconds
 * @param options - Configuration options (e.g., run immediately on start)
 * @returns Effect that creates a Poller with start/stop operations
 *
 * @example
 * ```typescript
 * const poller = yield* createPoller(
 *   Effect.sync(() => console.log('tick')),
 *   1000,
 *   { immediate: true }
 * );
 *
 * yield* poller.start; // Logs "tick" immediately, then every 1s
 * yield* Effect.sleep(Duration.seconds(5));
 * yield* poller.stop;  // Stops the poller
 * ```
 *
 * @example With LoggingService
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const poller = yield* createPoller(
 *     Effect.sync(() => console.log('tick')),
 *     1000
 *   );
 *   yield* poller.start;
 * });
 *
 * // Run with logging layer
 * Effect.runPromise(program.pipe(Effect.provide(ConsoleLoggingLayer)));
 * ```
 */
export function createPoller<E, R>(
  callback: Effect.Effect<void, E, R>,
  intervalMs: number,
  options?: PollerOptions
): Effect.Effect<Poller, never, R> {
  return Effect.gen(function* () {
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);

    // Try to get LoggingService if available, otherwise use console.error
    const maybeLogging = yield* Effect.serviceOption(LoggingService);

    const logError = (message: string, error: unknown): Effect.Effect<void, never, never> => {
      if (maybeLogging._tag === 'Some') {
        return maybeLogging.value.error(message, error);
      }
      return Effect.sync(() => {
        console.error(message, error);
      });
    };

    const start = Effect.gen(function* () {
      // Stop any running poller
      const existingFiber = yield* Ref.get(fiberRef);
      if (existingFiber !== null) {
        yield* Fiber.interrupt(existingFiber);
      }

      // Build the repeating callback with error handling
      const safeCallback = callback.pipe(
        Effect.catchAll((error) =>
          logError('Error in poller callback:', error)
        )
      );

      const repeating = safeCallback.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(intervalMs)))
      );

      // Optionally run immediately before starting the interval
      const effectToRun = options?.immediate === true
        ? Effect.flatMap(safeCallback, () => repeating)
        : repeating;

      // Fork and store the fiber
      const fiber = yield* Effect.fork(effectToRun);
      yield* Ref.set(fiberRef, fiber);
    });

    const stop = Effect.gen(function* () {
      const fiber = yield* Ref.get(fiberRef);
      if (fiber !== null) {
        yield* Fiber.interrupt(fiber);
        yield* Ref.set(fiberRef, null);
      }
    });

    return {
      start,
      stop,
    };
  });
}

/**
 * Creates a managed poller that automatically stops when the scope exits.
 * Uses Effect.acquireRelease to guarantee cleanup.
 *
 * @param callback - Effect to execute on each interval
 * @param intervalMs - Time between executions in milliseconds
 * @param options - Configuration options
 * @returns Scoped effect that provides a Poller with guaranteed cleanup
 *
 * @example
 * ```typescript
 * Effect.scoped(
 *   Effect.gen(function* () {
 *     const poller = yield* createManagedPoller(
 *       Effect.sync(() => console.log('tick')),
 *       1000,
 *       { immediate: true }
 *     );
 *     yield* poller.start;
 *     yield* Effect.sleep(Duration.seconds(5));
 *     // Poller automatically stops when scope exits
 *   })
 * );
 * ```
 */
export function createManagedPoller<E, R>(
  callback: Effect.Effect<void, E, R>,
  intervalMs: number,
  options?: PollerOptions
): Effect.Effect<Poller, never, R | Exclude<R, LoggingService>> {
  return Effect.acquireRelease(
    createPoller(callback, intervalMs, options),
    (poller) => poller.stop
  );
}

/**
 * Runs an effect repeatedly on an interval.
 * Convenience function that creates and starts a poller.
 *
 * @param effect - Effect to execute on each interval
 * @param intervalMs - Time between executions in milliseconds
 * @param options - Configuration options
 * @returns Effect that runs the poller (never completes unless interrupted)
 *
 * @example
 * ```typescript
 * const program = repeatOnInterval(
 *   Effect.sync(() => console.log('tick')),
 *   1000,
 *   { immediate: true }
 * );
 *
 * // Run until interrupted
 * Effect.runPromise(program);
 * ```
 */
export function repeatOnInterval<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  intervalMs: number,
  options?: PollerOptions
): Effect.Effect<void, never, R> {
  return Effect.gen(function* () {
    const poller = yield* createPoller(
      effect.pipe(Effect.asVoid),
      intervalMs,
      options
    );
    yield* poller.start;
    // Keep the effect alive by yielding forever
    yield* Effect.never;
  });
}

/**
 * Live layer that provides console-based logging for pollers
 */
export const PollingServiceLive: Layer.Layer<LoggingService> = ConsoleLoggingLayer;
