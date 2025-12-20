import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schedule from 'effect/Schedule';
import * as Ref from 'effect/Ref';
import * as Duration from 'effect/Duration';
import { getErrorMessage } from '../../src/lib/errors';
import type { OffscreenReadyResponse } from '../../src/lib/messages';

// ============================================================================
// Errors
// ============================================================================

export class OffscreenError extends Data.TaggedError('OffscreenError')<{
  readonly reason: 'creation_failed' | 'ping_timeout' | 'api_unavailable' | 'context_check_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Configuration
// ============================================================================

export interface OffscreenConfig {
  readonly pingInitialDelayMs: number;
  readonly pingMaxDelayMs: number;
  readonly pingTimeoutMs: number;
  readonly maxPingAttempts: number;
  readonly documentUrl: string;
  readonly reasons: chrome.offscreen.Reason[];
  readonly justification: string;
}

export const defaultOffscreenConfig: OffscreenConfig = {
  pingInitialDelayMs: 50,
  pingMaxDelayMs: 500,
  pingTimeoutMs: 200,
  maxPingAttempts: 10,
  documentUrl: 'src/offscreen/offscreen.html',
  reasons: ['DOM_SCRAPING'],
  justification: 'Parse HTML content for bookmark processing',
};

// ============================================================================
// Service Definition
// ============================================================================

export class OffscreenService extends Context.Tag('OffscreenService')<
  OffscreenService,
  {
    /**
     * Ensures the offscreen document is created and ready to receive messages.
     * This function is idempotent - calling it multiple times is safe.
     * Returns an effect that succeeds when the document is ready.
     */
    readonly ensureDocument: () => Effect.Effect<void, OffscreenError>;

    /**
     * Pings the offscreen document to check if it's ready.
     * Returns true if the document responds, false otherwise.
     */
    readonly ping: (timeoutMs?: number) => Effect.Effect<boolean, never>;

    /**
     * Resets the ready state. Useful if the offscreen document is closed.
     */
    readonly reset: () => Effect.Effect<void, never>;
  }
>() {}

// ============================================================================
// Service State
// ============================================================================

interface OffscreenState {
  /**
   * Tracks if the offscreen document has responded to a ping.
   */
  readonly ready: boolean;

  /**
   * Tracks if document creation is currently in progress.
   * Stores the effect to allow waiting on concurrent calls.
   */
  readonly creating: boolean;
}

const initialState: OffscreenState = {
  ready: false,
  creating: false,
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Creates the live implementation of OffscreenService.
 */
export const OffscreenServiceLive: Layer.Layer<OffscreenService, never> = Layer.effect(
  OffscreenService,
  Effect.gen(function* () {
    // State management using Ref for thread-safe mutable state
    const stateRef = yield* Ref.make(initialState);
    const config = defaultOffscreenConfig;

    /**
     * Sleep for a specified duration
     */
    const sleep = (ms: number): Effect.Effect<void> =>
      Effect.sleep(Duration.millis(ms));

    /**
     * Ping the offscreen document with a timeout
     */
    const ping = (timeoutMs: number = config.pingTimeoutMs): Effect.Effect<boolean, never> =>
      Effect.gen(function* () {
        // Skip in non-Chrome environments
        if (!__IS_CHROME__) {
          return true;
        }

        return yield* Effect.async<boolean, never>((resume) => {
          const timeoutId = setTimeout(() => {
            resume(Effect.succeed(false));
          }, timeoutMs);

          chrome.runtime.sendMessage(
            { type: 'offscreen:ping' },
            (response: OffscreenReadyResponse | undefined) => {
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                resume(Effect.succeed(false));
                return;
              }
              resume(Effect.succeed(response?.ready === true));
            }
          );
        });
      });

    /**
     * Wait for the offscreen document to become ready using exponential backoff
     */
    const waitForReady = (): Effect.Effect<void, OffscreenError> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.ready) {
          return;
        }

        // Create a retry schedule with exponential backoff
        const retrySchedule = Schedule.exponential(Duration.millis(config.pingInitialDelayMs)).pipe(
          Schedule.either(Schedule.spaced(Duration.millis(config.pingMaxDelayMs))),
          Schedule.compose(Schedule.recurs(config.maxPingAttempts - 1))
        );

        const pingWithRetry = ping().pipe(
          Effect.flatMap((ready) =>
            ready
              ? Effect.void
              : Effect.fail(new OffscreenError({
                  reason: 'ping_timeout',
                  message: 'Offscreen document not ready',
                }))
          ),
          Effect.retry(retrySchedule),
          Effect.tap(() =>
            Ref.update(stateRef, (s) => ({ ...s, ready: true }))
          ),
          Effect.catchAll((error) =>
            // Log warning but don't fail - let actual message timeouts handle failures
            Effect.sync(() => {
              console.warn('[Offscreen] Document did not respond to pings, proceeding anyway');
            })
          )
        );

        yield* pingWithRetry;

        const finalState = yield* Ref.get(stateRef);
        if (finalState.ready) {
          console.log('[Offscreen] Document ready');
        }
      });

    /**
     * Check if offscreen document already exists using getContexts API
     */
    const documentExists = (): Effect.Effect<boolean, OffscreenError> =>
      Effect.gen(function* () {
        // Skip in non-Chrome environments
        if (!__IS_CHROME__) {
          return false;
        }

        const runtimeApi = chrome.runtime;
        if (typeof runtimeApi.getContexts !== 'function') {
          // API not available, can't check
          return false;
        }

        return yield* Effect.tryPromise({
          try: async () => {
            const contexts = await runtimeApi.getContexts({
              contextTypes: ['OFFSCREEN_DOCUMENT'],
            });
            return contexts.length > 0;
          },
          catch: (error) =>
            new OffscreenError({
              reason: 'context_check_failed',
              message: 'Failed to check for existing offscreen document',
              cause: error,
            }),
        });
      });

    /**
     * Create the offscreen document
     */
    const createDocument = (): Effect.Effect<void, OffscreenError> =>
      Effect.gen(function* () {
        // Skip in non-Chrome environments
        if (!__IS_CHROME__) {
          return;
        }

        const offscreenApi = chrome.offscreen;
        if (typeof offscreenApi.createDocument !== 'function') {
          return yield* Effect.fail(
            new OffscreenError({
              reason: 'api_unavailable',
              message: 'Offscreen API not available',
            })
          );
        }

        yield* Effect.tryPromise({
          try: async () => {
            await offscreenApi.createDocument({
              url: config.documentUrl,
              reasons: config.reasons,
              justification: config.justification,
            });
            console.log('[Offscreen] Document created');
          },
          catch: (error) => {
            const errorMessage = getErrorMessage(error);
            // "single offscreen" error means document already exists - that's fine
            if (errorMessage.includes('single offscreen')) {
              console.log('[Offscreen] Document already exists');
              return null; // Signal to skip error
            }
            return new OffscreenError({
              reason: 'creation_failed',
              message: `Failed to create offscreen document: ${errorMessage}`,
              cause: error,
            });
          },
        }).pipe(
          Effect.flatMap((error) =>
            error === null ? Effect.void : Effect.fail(error)
          )
        );
      });

    /**
     * Ensure document exists and is ready
     */
    const ensureDocument = (): Effect.Effect<void, OffscreenError> =>
      Effect.gen(function* () {
        // Skip in non-Chrome environments
        if (!__IS_CHROME__) {
          return;
        }

        const state = yield* Ref.get(stateRef);

        // If creation is already in progress, wait for it
        if (state.creating) {
          // Create a polling effect that waits for creation to complete
          const waitForCreation = Effect.gen(function* () {
            yield* sleep(50);
            const currentState = yield* Ref.get(stateRef);
            if (currentState.creating) {
              return yield* Effect.fail('still_creating');
            }
          }).pipe(
            Effect.retry(
              Schedule.spaced(Duration.millis(50)).pipe(
                Schedule.compose(Schedule.recurs(20)) // Max 1 second wait
              )
            ),
            Effect.catchAll(() => Effect.void) // Give up and proceed
          );

          yield* waitForCreation;
          const updatedState = yield* Ref.get(stateRef);
          if (updatedState.ready) {
            return;
          }
        }

        // Check if document already exists
        const exists = yield* documentExists().pipe(
          Effect.catchAll(() => Effect.succeed(false))
        );

        if (exists) {
          yield* waitForReady();
          return;
        }

        // Set creating flag
        yield* Ref.update(stateRef, (s) => ({ ...s, creating: true }));

        // Create document and wait for ready
        const createAndWait = Effect.gen(function* () {
          yield* createDocument();
          yield* waitForReady();
        }).pipe(
          Effect.ensuring(
            // Always clear creating flag
            Ref.update(stateRef, (s) => ({ ...s, creating: false }))
          )
        );

        yield* createAndWait;
      });

    /**
     * Reset the ready state
     */
    const reset = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Ref.set(stateRef, initialState);
        yield* Effect.sync(() => {
          console.log('[Offscreen] State reset');
        });
      });

    return {
      ensureDocument,
      ping,
      reset,
    };
  })
);

// ============================================================================
// Convenience Functions (for compatibility with existing code)
// ============================================================================

/**
 * Ensures the offscreen document is created and ready.
 * This is a convenience function that runs the effect with the live layer.
 *
 * For new code, prefer using the OffscreenService directly via dependency injection.
 */
export const ensureOffscreenDocument = (): Effect.Effect<void, OffscreenError, OffscreenService> =>
  Effect.gen(function* () {
    const service = yield* OffscreenService;
    yield* service.ensureDocument();
  });

/**
 * Resets the offscreen ready state.
 * This is a convenience function that runs the effect with the live layer.
 *
 * For new code, prefer using the OffscreenService directly via dependency injection.
 */
export const resetOffscreenState = (): Effect.Effect<void, never, OffscreenService> =>
  Effect.gen(function* () {
    const service = yield* OffscreenService;
    yield* service.reset();
  });
