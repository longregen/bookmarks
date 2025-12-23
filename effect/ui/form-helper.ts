import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type * as Runtime from 'effect/Runtime';
import { DOMService, DOMError } from './dom';
import { withButtonState } from './ui-helpers';

// ===== Errors =====

export class FormLoadError extends Data.TaggedError('FormLoadError')<{
  readonly formId: string;
  readonly cause: unknown;
}> {}

export class FormSaveError extends Data.TaggedError('FormSaveError')<{
  readonly formId: string;
  readonly cause: unknown;
}> {}

export class StatusMessageService extends Context.Tag('StatusMessageService')<
  StatusMessageService,
  {
    readonly show: (
      container: HTMLElement,
      message: string,
      type: 'success' | 'error' | 'info',
      duration?: number
    ) => Effect.Effect<void, never>;
  }
>() {}

// ===== Configuration =====

export interface FormConfig<LoadError = FormLoadError, SaveError = FormSaveError> {
  readonly formId: string;
  readonly statusId: string;
  readonly onLoad: Effect.Effect<void, LoadError, DOMService>;
  readonly onSave: Effect.Effect<void, SaveError, DOMService>;
  readonly saveButtonText?: {
    readonly default: string;
    readonly saving: string;
  };
}

// ===== Public API =====

// Note: withButtonState is now imported from ui-helpers.ts
// Re-export for backward compatibility
export { withButtonState } from './ui-helpers';

/**
 * Initializes a settings form with load/save lifecycle.
 * Sets up form submission handling with proper error handling and status messages.
 *
 * @param config - Form configuration with load/save effects
 * @returns Effect that sets up the form when executed
 *
 * @example
 * ```typescript
 * const formEffect = initSettingsForm({
 *   formId: 'settings-form',
 *   statusId: 'status-message',
 *   onLoad: Effect.gen(function* () {
 *     const settings = yield* loadSettings();
 *     populateForm(settings);
 *   }),
 *   onSave: Effect.gen(function* () {
 *     const settings = readFormData();
 *     yield* saveSettings(settings);
 *   })
 * });
 *
 * // Run with runtime that provides DOMService and StatusMessageService
 * Effect.runPromise(formEffect.pipe(Effect.provide(appLayer)));
 * ```
 */
export function initSettingsForm<LoadError, SaveError>(
  config: FormConfig<LoadError, SaveError>
): Effect.Effect<
  void,
  DOMError | LoadError | SaveError,
  DOMService | StatusMessageService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;
    const statusService = yield* StatusMessageService;

    // Get DOM elements
    const form = yield* dom.getElement<HTMLFormElement>(config.formId);
    const statusDiv = yield* dom.getElement<HTMLDivElement>(config.statusId);

    // Load initial settings
    yield* config.onLoad.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.logError('Error loading settings', error);
          yield* statusService.show(
            statusDiv,
            'Failed to load settings',
            'error',
            5000
          );
        })
      )
    );

    // Set up form submission handler
    // The handler captures services in closure and runs effects when form is submitted
    yield* Effect.sync(() => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

      // Create the submit effect
      const submitEffect = Effect.gen(function* () {
        const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]');

        if (!submitBtn) {
          return;
        }

        const savingText = config.saveButtonText?.saving ?? 'Saving...';

        // Execute save with button state management
        yield* withButtonState(submitBtn, savingText, config.onSave).pipe(
          // On success, show success message
          Effect.tap(() =>
            statusService.show(
              statusDiv,
              'Settings saved successfully!',
              'success',
              5000
            )
          ),
          // On save error, show error message
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.logError('Error saving settings', error);
              yield* statusService.show(
                statusDiv,
                'Failed to save settings',
                'error',
                5000
              );
            })
          )
        );
      });

      // Run the effect with current runtime context
      // Note: This requires the runtime to be available in the environment
      // The effect will use the services that were captured in the closure
      Effect.runPromise(
        submitEffect.pipe(
          Effect.provideService(DOMService, dom),
          Effect.provideService(StatusMessageService, statusService)
        )
      ).catch((error) => {
        // Final fallback for unhandled errors
          console.error('Unhandled form submission error:', error);
        });
      });
    });
  });
}

/**
 * Version of initSettingsForm that returns a runtime-aware initializer.
 * Use this when you need to defer execution until runtime is ready.
 *
 * @param config - Form configuration
 * @param runtime - Effect runtime with required services
 * @returns Function that initializes the form
 */
export function initSettingsFormWithRuntime<LoadError, SaveError>(
  config: FormConfig<LoadError, SaveError>,
  runtime: Runtime.Runtime<DOMService | StatusMessageService>
): () => void {
  return () => {
    const effect = initSettingsForm(config);
    Effect.runPromise(effect.pipe(Effect.provide(runtime))).catch((error) => {
      console.error('Failed to initialize settings form:', error);
    });
  };
}
