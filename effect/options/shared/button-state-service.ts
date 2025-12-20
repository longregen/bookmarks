import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

/**
 * Shared service for managing button state during async operations
 */
export class ButtonStateService extends Context.Tag('ButtonStateService')<
  ButtonStateService,
  {
    readonly withButtonState: <A, E, R>(
      button: HTMLButtonElement,
      loadingText: string,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
  }
>() {}

/**
 * Live implementation of ButtonStateService
 */
export const ButtonStateServiceLive: Layer.Layer<ButtonStateService, never, never> =
  Layer.succeed(ButtonStateService, {
    withButtonState: <A, E, R>(
      button: HTMLButtonElement,
      loadingText: string,
      effect: Effect.Effect<A, E, R>
    ) =>
      Effect.gen(function* () {
        const originalText = button.textContent ?? '';
        const originalDisabled = button.disabled;

        yield* Effect.sync(() => {
          button.textContent = loadingText;
          button.disabled = true;
        });

        try {
          return yield* effect;
        } finally {
          yield* Effect.sync(() => {
            button.textContent = originalText;
            button.disabled = originalDisabled;
          });
        }
      }),
  });
