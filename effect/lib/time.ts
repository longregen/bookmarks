import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

/**
 * TimeService provides time-related operations.
 *
 * This service abstracts time operations to enable:
 * - Testing with frozen/mocked time
 * - Consistent time formatting across the application
 * - Potential future localization
 */
export class TimeService extends Context.Tag('TimeService')<
  TimeService,
  {
    /**
     * Get the current timestamp.
     * Useful for testing - can be mocked to return a fixed time.
     */
    now(): Effect.Effect<Date, never>;

    /**
     * Format a date as a human-readable "time ago" string.
     * Examples: "Just now", "5 minutes ago", "3 hours ago", "2 days ago"
     */
    formatTimeAgo(date: Date): Effect.Effect<string, never>;
  }
>() {}

/**
 * Default implementation of TimeService using system time.
 */
export const TimeServiceLive: Layer.Layer<TimeService, never> = Layer.succeed(
  TimeService,
  TimeService.of({
    now: () => Effect.sync(() => new Date()),

    formatTimeAgo: (date: Date) =>
      Effect.sync(() => {
        const now = new Date();
        const diff = now.getTime() - new Date(date).getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Just now';
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
        return new Date(date).toLocaleDateString();
      }),
  })
);

/**
 * Get current timestamp as an Effect.
 * Requires TimeService in context.
 */
export const now = (): Effect.Effect<Date, never, TimeService> =>
  Effect.gen(function* () {
    const timeService = yield* TimeService;
    return yield* timeService.now();
  });

/**
 * Format a date as "time ago" string.
 * Requires TimeService in context.
 *
 * @example
 * ```typescript
 * const effect = formatTimeAgo(bookmark.createdAt);
 * const result = await Effect.runPromise(
 *   effect.pipe(Effect.provide(TimeServiceLive))
 * );
 * console.log(result); // "5 minutes ago"
 * ```
 */
export const formatTimeAgo = (
  date: Date
): Effect.Effect<string, never, TimeService> =>
  Effect.gen(function* () {
    const timeService = yield* TimeService;
    return yield* timeService.formatTimeAgo(date);
  });

/**
 * Standalone pure function for formatting time ago.
 * This provides backwards compatibility with the original API.
 * Use this when you don't need dependency injection or testing hooks.
 *
 * @example
 * ```typescript
 * const ago = formatTimeAgoPure(bookmark.createdAt);
 * console.log(ago); // "5 minutes ago"
 * ```
 */
export function formatTimeAgoPure(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString();
}

/**
 * Test implementation that allows freezing time.
 * Useful for deterministic tests.
 *
 * @example
 * ```typescript
 * const fixedTime = new Date('2025-01-01T12:00:00Z');
 * const testLayer = TimeServiceTest(fixedTime);
 *
 * const result = await Effect.runPromise(
 *   formatTimeAgo(new Date('2025-01-01T11:55:00Z'))
 *     .pipe(Effect.provide(testLayer))
 * );
 * console.log(result); // "5 minutes ago"
 * ```
 */
export const TimeServiceTest = (
  fixedNow: Date
): Layer.Layer<TimeService, never> =>
  Layer.succeed(
    TimeService,
    TimeService.of({
      now: () => Effect.sync(() => new Date(fixedNow)),

      formatTimeAgo: (date: Date) =>
        Effect.sync(() => {
          const diff = fixedNow.getTime() - new Date(date).getTime();
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          const days = Math.floor(hours / 24);

          if (seconds < 60) return 'Just now';
          if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
          if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
          if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
          return new Date(date).toLocaleDateString();
        }),
    })
  );
