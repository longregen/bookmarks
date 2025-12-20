import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { makeLayer, makeEffectLayer } from './effect-utils';
import { TIME } from '../../src/lib/constants';
import type { ConfigService } from '../services/config-service';

/**
 * Service for formatting dates with age-based presentation
 *
 * Provides relative time formatting (e.g., "5m ago") for recent dates
 * and absolute formatting for older dates based on configurable thresholds.
 */
export class DateFormatService extends Context.Tag('DateFormatService')<
  DateFormatService,
  {
    /**
     * Formats a date as relative time (e.g., "just now", "5m ago", "3 days ago")
     * @param date - The date to format
     * @param now - Current time (defaults to current time if not provided)
     */
    formatRelativeTime(date: Date, now?: Date): Effect.Effect<string, never>;

    /**
     * Formats a date based on its age relative to now
     * - Recent dates: relative time (e.g., "5m ago")
     * - Medium age: short date (e.g., "Jan 15")
     * - Old dates: ISO date (e.g., "2024-01-15")
     *
     * Thresholds are configured via ConfigService
     * @param date - The date to format
     * @param now - Current time (defaults to current time if not provided)
     */
    formatDateByAge(date: Date, now?: Date): Effect.Effect<string, never>;
  }
>() {}

/**
 * Internal implementation of relative time formatting
 */
function formatRelativeTimeImpl(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / TIME.SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / TIME.MINUTES_PER_HOUR);
  const days = Math.floor(hours / TIME.HOURS_PER_DAY);

  if (seconds < TIME.SECONDS_PER_MINUTE) return 'just now';
  if (minutes < TIME.MINUTES_PER_HOUR) return `${minutes}m ago`;
  if (hours < TIME.HOURS_PER_DAY) return `${hours}h ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Layer providing DateFormatService implementation
 * Requires ConfigService for threshold configuration
 */
export const DateFormatServiceLive: Layer.Layer<
  DateFormatService,
  never,
  ConfigService
> = makeEffectLayer(
  DateFormatService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    return {
      formatRelativeTime: (date: Date, now?: Date) =>
        Effect.sync(() => {
          const currentTime = now ?? new Date();
          return formatRelativeTimeImpl(date, currentTime);
        }),

      formatDateByAge: (date: Date, now?: Date) =>
        Effect.gen(function* () {
          const currentTime = now ?? new Date();
          const diffMs = currentTime.getTime() - date.getTime();
          const diffDays = diffMs / TIME.MS_PER_DAY;

          const thresholds = yield* config.get();

          if (diffDays < thresholds.DATE_RELATIVE_TIME_THRESHOLD_DAYS) {
            return formatRelativeTimeImpl(date, currentTime);
          } else if (diffDays < thresholds.DATE_FULL_DATE_THRESHOLD_DAYS) {
            return date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
          } else {
            return date.toISOString().split('T')[0];
          }
        }),
    };
  })
);

/**
 * Helper function to format relative time without explicit service dependency
 * Useful for quick formatting when you have a runtime with DateFormatService
 *
 * @example
 * ```typescript
 * const runtime = Effect.runSync(
 *   Effect.provide(myProgram, DateFormatServiceLive)
 * );
 *
 * const formatted = Effect.runSync(
 *   formatRelativeTime(someDate),
 *   runtime
 * );
 * ```
 */
export function formatRelativeTime(
  date: Date,
  now?: Date
): Effect.Effect<string, never, DateFormatService> {
  return Effect.gen(function* () {
    const service = yield* DateFormatService;
    return yield* service.formatRelativeTime(date, now);
  });
}

/**
 * Helper function to format date by age without explicit service dependency
 * Useful for quick formatting when you have a runtime with DateFormatService
 *
 * @example
 * ```typescript
 * const runtime = Effect.runSync(
 *   Effect.provide(myProgram, AppLayer)
 * );
 *
 * const formatted = Effect.runSync(
 *   formatDateByAge(someDate),
 *   runtime
 * );
 * ```
 */
export function formatDateByAge(
  date: Date,
  now?: Date
): Effect.Effect<string, never, DateFormatService> {
  return Effect.gen(function* () {
    const service = yield* DateFormatService;
    return yield* service.formatDateByAge(date, now);
  });
}

/**
 * Test-friendly layer that allows injecting custom thresholds
 * Useful for testing different date formatting scenarios
 */
export const makeDateFormatServiceTest = (config: {
  DATE_RELATIVE_TIME_THRESHOLD_DAYS: number;
  DATE_FULL_DATE_THRESHOLD_DAYS: number;
}): Layer.Layer<DateFormatService, never, never> => {
  const mockConfigService = makeLayer(ConfigService, {
    get: () => Effect.succeed(config),
    update: () => Effect.void,
    observe: () => Effect.succeed(() => Effect.void),
  } as any);

  return DateFormatServiceLive.pipe(Layer.provide(mockConfigService));
};
