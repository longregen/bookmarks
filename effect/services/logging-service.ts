import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';

export class LoggingService extends Context.Tag('LoggingService')<
  LoggingService,
  {
    readonly debug: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    readonly info: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    readonly warn: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;

    readonly error: (
      message: string,
      context?: Record<string, unknown>
    ) => Effect.Effect<void, never, never>;
  }
>() {}
