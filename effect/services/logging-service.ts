import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';

/**
 * Service for logging in an Effect context
 *
 * Provides debug, info, warn, and error logging capabilities
 * with structured context support.
 */
export class LoggingService extends Context.Tag('LoggingService')<
  LoggingService,
  {
    /**
     * Log a debug message with optional context
     * @param message - Debug message
     * @param context - Optional structured context data
     */
    readonly debug: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    /**
     * Log an info message with optional context
     * @param message - Info message
     * @param context - Optional structured context data
     */
    readonly info: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    /**
     * Log a warning message with optional context
     * @param message - Warning message
     * @param context - Optional structured context data
     */
    readonly warn: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    /**
     * Log an error message with optional context and error object
     * @param message - Error message
     * @param context - Optional structured context data
     */
    readonly error: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;
  }
>() {}
