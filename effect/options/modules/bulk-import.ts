import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import * as Ref from 'effect/Ref';
import { makeLayer, makeEffectLayer } from '../../lib/effect-utils';
import { createPoller, type Poller } from '../../lib/polling-manager';
import { validateUrls, createBulkImportJob, type ValidationResult } from '../../lib/bulk-import';
import { getErrorMessage } from '../../lib/errors';
import type { Bookmark } from '../../db/schema';
import { db } from '../../../src/db/schema';
import { startProcessingQueue } from '../../../src/background/queue';
import { UIElementNotFoundError, UIService as SharedUIService, UIServiceLive as SharedUIServiceLive } from '../shared';
import { getElement } from '../shared/dom-helpers';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ProgressStatus {
  readonly downloaded: number;
  readonly completed: number;
  readonly errors: number;
  readonly processing: number;
  readonly total: number;
  readonly percent: number;
}

export interface UIElements {
  readonly bulkUrlsInput: HTMLTextAreaElement;
  readonly urlValidationFeedback: HTMLDivElement;
  readonly startBulkImportBtn: HTMLButtonElement;
  readonly statusDiv: HTMLDivElement;
  readonly bulkImportProgress: HTMLDivElement;
  readonly bulkImportProgressBar: HTMLDivElement;
  readonly bulkImportStatus: HTMLSpanElement;
}

// ============================================================================
// Typed Errors
// ============================================================================

export class ValidationUIError extends Data.TaggedError('ValidationUIError')<{
  readonly reason: 'no_valid_urls' | 'update_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ImportStartError extends Data.TaggedError('ImportStartError')<{
  readonly reason: 'job_creation_failed' | 'chrome_message_failed';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ProgressPollingError extends Data.TaggedError('ProgressPollingError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Service Definitions
// ============================================================================

/**
 * Service for managing UI elements and interactions
 */
export class UIService extends Context.Tag('UIService')<
  UIService,
  {
    readonly getElements: () => Effect.Effect<UIElements, UIElementNotFoundError, never>;
    readonly showValidationFeedback: (
      validation: ValidationResult
    ) => Effect.Effect<void, never, never>;
    readonly enableImportButton: () => Effect.Effect<void, never, never>;
    readonly disableImportButton: () => Effect.Effect<void, never, never>;
    readonly showProgress: (total: number) => Effect.Effect<void, never, never>;
    readonly hideProgress: () => Effect.Effect<void, never, never>;
    readonly updateProgressBar: (status: ProgressStatus) => Effect.Effect<void, never, never>;
    readonly showStatus: (
      message: string,
      type: 'success' | 'error' | 'warning',
      timeoutMs?: number
    ) => Effect.Effect<void, never, never>;
    readonly clearInput: () => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Service for managing bulk import operations
 */
export class BulkImportService extends Context.Tag('BulkImportService')<
  BulkImportService,
  {
    readonly createImport: (
      urls: string[]
    ) => Effect.Effect<void, ImportStartError, never>;
  }
>() {}

/**
 * Service for tracking import progress
 */
export class ProgressTrackingService extends Context.Tag('ProgressTrackingService')<
  ProgressTrackingService,
  {
    readonly startTracking: (
      urls: string[]
    ) => Effect.Effect<void, ProgressPollingError, never>;
    readonly stopTracking: () => Effect.Effect<void, never, never>;
  }
>() {}

// ============================================================================
// Service Implementations
// ============================================================================

/**
 * Creates the UIService implementation using shared UIService where possible
 */
const makeUIService = (elements: UIElements, sharedUI: SharedUIService['Type']): UIService['Type'] => ({
  getElements: () => Effect.succeed(elements),

  showValidationFeedback: (validation: ValidationResult) =>
    Effect.sync(() => {
      const { urlValidationFeedback, startBulkImportBtn } = elements;

      if (validation.validUrls.length === 0) {
        urlValidationFeedback.className = 'validation-feedback show invalid';
        urlValidationFeedback.textContent = 'No valid URLs found';
        startBulkImportBtn.disabled = true;
        return;
      }

      let feedbackClass = 'validation-feedback show valid';
      let feedbackText = `${validation.validUrls.length} valid URL(s)`;

      if (validation.invalidUrls.length > 0) {
        feedbackClass = 'validation-feedback show warning';
        feedbackText += `, ${validation.invalidUrls.length} invalid URL(s)`;
      }

      if (validation.duplicates.length > 0) {
        feedbackClass = 'validation-feedback show warning';
        feedbackText += `, ${validation.duplicates.length} duplicate(s)`;
      }

      urlValidationFeedback.className = feedbackClass;
      urlValidationFeedback.textContent = feedbackText;
      startBulkImportBtn.disabled = false;
    }),

  enableImportButton: () =>
    Effect.sync(() => {
      elements.startBulkImportBtn.disabled = false;
    }),

  disableImportButton: () =>
    Effect.sync(() => {
      elements.startBulkImportBtn.disabled = true;
    }),

  showProgress: (total: number) =>
    Effect.gen(function* () {
      yield* sharedUI.showElement(elements.bulkImportProgress);
      yield* Effect.sync(() => {
        elements.bulkImportProgressBar.style.width = '0%';
        elements.bulkImportStatus.textContent = `Imported 0 of ${total}`;
      });
    }),

  hideProgress: () => sharedUI.hideElement(elements.bulkImportProgress),

  updateProgressBar: (status: ProgressStatus) =>
    Effect.sync(() => {
      const { bulkImportProgressBar, bulkImportStatus } = elements;
      const finishedCount = status.completed + status.errors;

      bulkImportProgressBar.style.width = `${status.percent}%`;

      // Show granular status
      let statusText: string;
      if (finishedCount >= status.total) {
        statusText = `Completed ${status.completed} of ${status.total}`;
      } else if (status.downloaded > 0 || status.processing > 0) {
        const totalProcessed = status.downloaded + status.completed + status.processing + status.errors;
        statusText = `Downloaded ${totalProcessed}/${status.total}, Processing ${status.completed}/${status.total}`;
      } else {
        statusText = `Fetching ${status.total - finishedCount} pages...`;
      }

      bulkImportStatus.textContent = statusText;
    }),

  showStatus: (message: string, type: 'success' | 'error' | 'warning', timeoutMs = 3000) =>
    sharedUI.showStatus(elements.statusDiv, message, type, timeoutMs),

  clearInput: () =>
    Effect.sync(() => {
      elements.bulkUrlsInput.value = '';
      elements.urlValidationFeedback.classList.remove('show');
    }),
});

/**
 * Creates the BulkImportService implementation
 */
const makeBulkImportService = (): BulkImportService['Type'] => ({
  createImport: (urls: string[]) =>
    Effect.gen(function* () {
      if (__IS_WEB__) {
        // Web mode: create job directly
        yield* Effect.tryPromise({
          try: async () => {
            await createBulkImportJob(urls);
            void startProcessingQueue();
          },
          catch: (error) =>
            new ImportStartError({
              reason: 'job_creation_failed',
              message: 'Failed to create bulk import job',
              cause: error,
            }),
        });
      } else {
        // Extension mode: send message to background
        yield* Effect.tryPromise({
          try: async () => {
            const response = await chrome.runtime.sendMessage({
              type: 'import:create_from_url_list',
              urls,
            }) as { success: boolean; error?: string };

            if (!response.success) {
              throw new Error(response.error ?? 'Failed to start bulk import');
            }
          },
          catch: (error) =>
            new ImportStartError({
              reason: 'chrome_message_failed',
              message: 'Failed to send import message to background',
              cause: error,
            }),
        });
      }
    }),
});

/**
 * Creates the ProgressTrackingService implementation
 */
const makeProgressTrackingService = (
  elements: UIElements
): Effect.Effect<ProgressTrackingService['Type'], never, never> =>
  Effect.gen(function* () {
    const pollerRef = yield* Ref.make<Poller | null>(null);

    const computeProgress = (bookmarks: Bookmark[], total: number): ProgressStatus => {
      let downloaded = 0;
      let completed = 0;
      let errors = 0;
      let processing = 0;

      for (const b of bookmarks) {
        if (b.status === 'error') {
          errors++;
        } else if (b.status === 'complete') {
          completed++;
        } else if (b.status === 'downloaded' || b.status === 'pending') {
          downloaded++;
        } else if (b.status === 'processing') {
          processing++;
        }
      }

      const finishedCount = completed + errors;
      const percent = Math.round((finishedCount / total) * 100);

      return {
        downloaded,
        completed,
        errors,
        processing,
        total,
        percent,
      };
    };

    const checkProgress = (urls: string[], total: number) =>
      Effect.gen(function* () {
        // Query bookmarks for the given URLs
        const bookmarks = yield* Effect.tryPromise({
          try: () => db.bookmarks.where('url').anyOf(urls).toArray(),
          catch: (error) =>
            new ProgressPollingError({
              message: 'Failed to query bookmark progress',
              cause: error,
            }),
        });

        const status = yield* Effect.sync(() => computeProgress(bookmarks, total));

        // Update UI
        const uiService = makeUIService(elements);
        yield* uiService.updateProgressBar(status);

        const finishedCount = status.completed + status.errors;

        // Check if complete
        if (finishedCount >= total) {
          yield* Effect.gen(function* () {
            // Stop polling
            const poller = yield* Ref.get(pollerRef);
            if (poller !== null) {
              yield* poller.stop;
              yield* Ref.set(pollerRef, null);
            }

            // Show completion status
            if (status.errors > 0) {
              yield* uiService.showStatus(
                `Bulk import completed with ${status.errors} error(s)`,
                'warning',
                5000
              );
            } else {
              yield* uiService.showStatus(
                'Bulk import completed successfully',
                'success',
                5000
              );
            }

            // Hide progress bar after delay
            yield* Effect.sleep('3 seconds').pipe(
              Effect.flatMap(() => uiService.hideProgress())
            );

            // Dispatch refresh event
            yield* Effect.sync(() => {
              const event = new CustomEvent('refresh-jobs');
              window.dispatchEvent(event);
            });
          });
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error('Error polling progress:', error);
          })
        )
      );

    return {
      startTracking: (urls: string[]) =>
        Effect.gen(function* () {
          const total = urls.length;

          // Create poller
          const poller = yield* createPoller(
            checkProgress(urls, total),
            1000,
            { immediate: true }
          );

          // Store poller reference
          yield* Ref.set(pollerRef, poller);

          // Start polling
          yield* poller.start;
        }),

      stopTracking: () =>
        Effect.gen(function* () {
          const poller = yield* Ref.get(pollerRef);
          if (poller !== null) {
            yield* poller.stop;
            yield* Ref.set(pollerRef, null);
          }
        }),
    };
  });

// ============================================================================
// Layers
// ============================================================================

/**
 * Creates a UIService layer from DOM elements
 */
export const makeUIServiceLayer = (
  elements: UIElements
): Layer.Layer<UIService, never, SharedUIService> =>
  makeEffectLayer(
    UIService,
    Effect.gen(function* () {
      const sharedUI = yield* SharedUIService;
      return makeUIService(elements, sharedUI);
    })
  );

/**
 * BulkImportService layer
 */
export const BulkImportServiceLive: Layer.Layer<BulkImportService, never, never> =
  makeLayer(BulkImportService, makeBulkImportService());

/**
 * Creates a ProgressTrackingService layer from DOM elements
 */
export const makeProgressTrackingServiceLayer = (
  elements: UIElements
): Layer.Layer<ProgressTrackingService, never, never> =>
  makeEffectLayer(ProgressTrackingService, makeProgressTrackingService(elements));

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Retrieves all required UI elements
 */
const getAllUIElements = (): Effect.Effect<UIElements, UIElementNotFoundError, never> =>
  Effect.gen(function* () {
    const bulkUrlsInput = yield* getElement<HTMLTextAreaElement>('bulkUrlsInput');
    const urlValidationFeedback = yield* getElement<HTMLDivElement>('urlValidationFeedback');
    const startBulkImportBtn = yield* getElement<HTMLButtonElement>('startBulkImport');
    const statusDiv = yield* getElement<HTMLDivElement>('status');
    const bulkImportProgress = yield* getElement<HTMLDivElement>('bulkImportProgress');
    const bulkImportProgressBar = yield* getElement<HTMLDivElement>('bulkImportProgressBar');
    const bulkImportStatus = yield* getElement<HTMLSpanElement>('bulkImportStatus');

    return {
      bulkUrlsInput,
      urlValidationFeedback,
      startBulkImportBtn,
      statusDiv,
      bulkImportProgress,
      bulkImportProgressBar,
      bulkImportStatus,
    };
  });

// ============================================================================
// Main Module Logic
// ============================================================================

/**
 * Sets up input validation with debouncing
 */
const setupInputValidation = (
  elements: UIElements,
  validationTimeoutRef: Ref.Ref<number | null>
): Effect.Effect<void, never, UIService> =>
  Effect.gen(function* () {
    const uiService = yield* UIService;

    yield* Effect.sync(() => {
      elements.bulkUrlsInput.addEventListener('input', () => {
        // Clear existing timeout
        const timeout = Ref.unsafeGet(validationTimeoutRef);
        if (timeout !== null) {
          clearTimeout(timeout);
        }

        // Set new timeout
        const newTimeout = window.setTimeout(() => {
          const urlsText = elements.bulkUrlsInput.value.trim();

          if (!urlsText) {
            Effect.runSync(
              Effect.gen(function* () {
                yield* Effect.sync(() => {
                  elements.urlValidationFeedback.classList.remove('show');
                });
                yield* uiService.disableImportButton();
              })
            );
            return;
          }

          const validation = validateUrls(urlsText);

          Effect.runSync(uiService.showValidationFeedback(validation));
        }, 500);

        Ref.unsafeSet(validationTimeoutRef, newTimeout);
      });
    });
  });

/**
 * Sets up the import button click handler
 */
const setupImportButton = (
  elements: UIElements
): Effect.Effect<void, never, UIService | BulkImportService | ProgressTrackingService> =>
  Effect.gen(function* () {
    const uiService = yield* UIService;
    const importService = yield* BulkImportService;
    const progressService = yield* ProgressTrackingService;

    yield* Effect.sync(() => {
      elements.startBulkImportBtn.addEventListener('click', () => {
        const program = Effect.gen(function* () {
          const urlsText = elements.bulkUrlsInput.value.trim();
          if (!urlsText) return;

          const validation = validateUrls(urlsText);
          if (validation.validUrls.length === 0) {
            yield* uiService.showStatus('No valid URLs to import', 'error', 5000);
            return;
          }

          yield* uiService.disableImportButton();
          yield* uiService.showProgress(validation.validUrls.length);

          // Create the import job
          yield* importService.createImport(validation.validUrls);

          // Clear input
          yield* uiService.clearInput();

          // Start progress tracking
          yield* progressService.startTracking(validation.validUrls);
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const message = `Failed to start bulk import: ${getErrorMessage(error)}`;
              yield* uiService.showStatus(message, 'error', 5000);
              yield* uiService.hideProgress();
              yield* progressService.stopTracking();
            })
          ),
          Effect.ensuring(uiService.enableImportButton())
        );

        Effect.runPromise(
          program.pipe(
            Effect.provide(
              Layer.mergeAll(
                makeUIServiceLayer(elements),
                BulkImportServiceLive,
                makeProgressTrackingServiceLayer(elements),
                SharedUIServiceLive
              )
            )
          )
        ).catch((error) => {
          console.error('Unexpected error in import handler:', error);
        });
      });
    });
  });

/**
 * Hides bulk import section for web platform
 */
const hideBulkImportForWeb = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (__IS_WEB__) {
      yield* Effect.sync(() => {
        const bulkImportSection = document.getElementById('bulk-import');
        if (bulkImportSection) {
          bulkImportSection.style.display = 'none';
        }
      });
    }
  });

/**
 * Initializes the bulk import module with Effect
 */
const initBulkImportModuleEffect = (): Effect.Effect<
  () => void,
  UIElementNotFoundError,
  UIService | BulkImportService | ProgressTrackingService
> =>
  Effect.gen(function* () {
    // Get UI elements
    const elements = yield* getAllUIElements();

    // Hide for web platform if needed
    yield* hideBulkImportForWeb();

    // Create validation timeout ref
    const validationTimeoutRef = yield* Ref.make<number | null>(null);

    // Setup event handlers
    yield* setupInputValidation(elements, validationTimeoutRef);
    yield* setupImportButton(elements);

    // Return cleanup function
    return (): void => {
      const timeout = Ref.unsafeGet(validationTimeoutRef);
      if (timeout !== null) {
        clearTimeout(timeout);
      }

      // Stop progress tracking
      const progressService = makeProgressTrackingService(elements);
      Effect.runPromise(
        progressService.pipe(
          Effect.flatMap((service) => service.stopTracking())
        )
      ).catch(() => {
        // Ignore cleanup errors
      });
    };
  });

// ============================================================================
// Legacy Compatibility Layer
// ============================================================================

/**
 * Initializes the bulk import module (legacy API)
 * @returns Cleanup function to stop polling and remove listeners
 */
export function initBulkImportModule(): () => void {
  let cleanup: (() => void) | null = null;

  const program = Effect.gen(function* () {
    const elements = yield* getAllUIElements();

    cleanup = yield* initBulkImportModuleEffect().pipe(
      Effect.provide(
        Layer.mergeAll(
          makeUIServiceLayer(elements),
          BulkImportServiceLive,
          makeProgressTrackingServiceLayer(elements),
          SharedUIServiceLive
        )
      )
    );
  });

  Effect.runPromise(program).catch((error) => {
    console.error('Failed to initialize bulk import module:', error);
  });

  return (): void => {
    if (cleanup !== null) {
      cleanup();
    }
  };
}
