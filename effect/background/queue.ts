/**
 * Queue management for bookmark processing pipeline
 *
 * This module orchestrates the two-phase bookmark processing:
 * 1. Fetch phase: Parallel HTML fetching with configurable concurrency
 * 2. Processing phase: Sequential content extraction, Q&A generation, embeddings
 *
 * Refactored to use Effect.ts for:
 * - Dependency injection via Context.Tag
 * - Typed error handling with Data.TaggedError
 * - Composable effects with Effect.gen
 * - Retry logic with Schedule
 * - Resource management with Ref
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import * as Ref from 'effect/Ref';
import type { Bookmark, JobItemStatus } from '../../src/db/schema';
import {
  FetchError,
  ProcessingError,
  RepositoryError,
  SyncError,
  getErrorMessage,
} from '../lib/errors';
import { calculateBackoffDelay } from '../lib/retry';
import { ConfigService } from '../services/config-service';
import { LoggingService } from '../services/logging-service';

/**
 * Service for bookmark CRUD operations
 * TODO: Move to separate service file when created
 */
export class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly getByStatus: (
      status: Bookmark['status'],
      limit?: number
    ) => Effect.Effect<Bookmark[], RepositoryError, never>;

    readonly update: (
      id: string,
      updates: Partial<Bookmark>
    ) => Effect.Effect<void, RepositoryError, never>;

    readonly bulkUpdate: (
      updates: Array<{ id: string; updates: Partial<Bookmark> }>
    ) => Effect.Effect<void, RepositoryError, never>;
  }
>() {}

/**
 * Service for fetching bookmark HTML
 * TODO: Move to separate service file when created
 */
export class FetchService extends Context.Tag('FetchService')<
  FetchService,
  {
    readonly fetchHtml: (
      bookmark: Bookmark
    ) => Effect.Effect<Bookmark, FetchError, never>;
  }
>() {}

/**
 * Service for processing bookmark content
 * TODO: Move to separate service file when created
 */
export class ProcessorService extends Context.Tag('ProcessorService')<
  ProcessorService,
  {
    readonly processContent: (
      bookmark: Bookmark
    ) => Effect.Effect<void, ProcessingError, never>;
  }
>() {}

/**
 * Service for job item management
 * TODO: Move to separate service file when created
 */
export class JobService extends Context.Tag('JobService')<
  JobService,
  {
    readonly updateJobItemByBookmark: (
      bookmarkId: string,
      updates: {
        status?: JobItemStatus;
        retryCount?: number;
        errorMessage?: string;
      }
    ) => Effect.Effect<void, RepositoryError, never>;

    readonly getJobItemByBookmark: (
      bookmarkId: string
    ) => Effect.Effect<
      { jobId: string; id: string } | null,
      RepositoryError,
      never
    >;

    readonly updateJobStatus: (
      jobId: string
    ) => Effect.Effect<void, RepositoryError, never>;
  }
>() {}

/**
 * Service for event broadcasting
 * TODO: Move to separate service file when created
 */
export class EventsService extends Context.Tag('EventsService')<
  EventsService,
  {
    readonly bookmarkProcessingStarted: (
      bookmarkId: string
    ) => Effect.Effect<void, never, never>;

    readonly bookmarkReady: (
      bookmarkId: string
    ) => Effect.Effect<void, never, never>;

    readonly bookmarkProcessingFailed: (
      bookmarkId: string,
      error: string
    ) => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Service for WebDAV sync operations
 * TODO: Move to separate service file when created
 */
export class SyncService extends Context.Tag('SyncService')<
  SyncService,
  {
    readonly triggerIfEnabled: () => Effect.Effect<void, SyncError, never>;
  }
>() {}

/**
 * Fetch a single bookmark with retry logic
 */
function fetchSingleBookmark(
  bookmark: Bookmark
): Effect.Effect<
  { success: boolean; bookmark: Bookmark },
  never,
  | BookmarkRepository
  | FetchService
  | JobService
  | ConfigService
  | LoggingService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const fetch = yield* FetchService;
    const jobService = yield* JobService;
    const config = yield* ConfigService;
    const logging = yield* LoggingService;

    const maxRetries = yield* config.get<number>('QUEUE_MAX_RETRIES');
    const currentRetryCount = bookmark.retryCount ?? 0;

    yield* logging.debug(
      `Fetching: ${bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`
    );

    const result = yield* fetch.fetchHtml(bookmark).pipe(
      Effect.matchEffect({
        onSuccess: (fetchedBookmark) =>
          Effect.gen(function* () {
            yield* logging.debug(`Downloaded: ${fetchedBookmark.title}`);
            return { success: true, bookmark: fetchedBookmark };
          }),
        onFailure: (error) =>
          Effect.gen(function* () {
            const errorMessage = getErrorMessage(error);
            yield* logging.error(
              `Fetch error for ${bookmark.url}: ${errorMessage}`
            );

            if (currentRetryCount < maxRetries) {
              const newRetryCount = currentRetryCount + 1;
              const retryMessage = `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`;

              yield* repo.update(bookmark.id, {
                status: 'fetching',
                retryCount: newRetryCount,
                errorMessage: retryMessage,
                updatedAt: new Date(),
              });

              yield* jobService.updateJobItemByBookmark(bookmark.id, {
                status: 'pending' as JobItemStatus,
                retryCount: newRetryCount,
                errorMessage: retryMessage,
              });
            } else {
              const failureMessage = `Failed after ${maxRetries + 1} attempts: ${errorMessage}`;

              yield* repo.update(bookmark.id, {
                status: 'error',
                errorMessage: failureMessage,
                updatedAt: new Date(),
              });

              yield* jobService.updateJobItemByBookmark(bookmark.id, {
                status: 'error' as JobItemStatus,
                errorMessage: failureMessage,
              });

              const jobItem = yield* jobService.getJobItemByBookmark(
                bookmark.id
              );
              if (jobItem) {
                yield* jobService.updateJobStatus(jobItem.jobId);
              }
            }

            return { success: false, bookmark };
          }),
      })
    );

    return result;
  });
}

/**
 * Process all bookmarks in 'fetching' status with parallel fetching
 */
function processFetchQueue(): Effect.Effect<
  void,
  never,
  | BookmarkRepository
  | FetchService
  | JobService
  | ConfigService
  | LoggingService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const config = yield* ConfigService;
    const logging = yield* LoggingService;

    const concurrency = yield* config.get<number>('FETCH_CONCURRENCY');
    yield* logging.info(
      `Starting parallel fetch phase (concurrency: ${concurrency})`
    );

    // Process batches until no more bookmarks to fetch
    while (true) {
      const bookmarksToFetch = yield* repo.getByStatus('fetching', concurrency);

      if (bookmarksToFetch.length === 0) {
        yield* logging.debug('No more bookmarks to fetch');
        break;
      }

      yield* logging.debug(
        `Fetching ${bookmarksToFetch.length} bookmarks in parallel`
      );

      // Process batch in parallel
      const results = yield* Effect.all(
        bookmarksToFetch.map((bookmark) => fetchSingleBookmark(bookmark)),
        { concurrency }
      );

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      yield* logging.debug(
        `Batch complete: ${successCount} succeeded, ${failureCount} failed/retrying`
      );

      // Small delay between batches to avoid overwhelming the system
      if (bookmarksToFetch.length === concurrency) {
        yield* Effect.sleep('100 millis');
      }
    }
  });
}

/**
 * Process a single bookmark's content with retry logic
 */
function processSingleBookmarkContent(
  bookmark: Bookmark
): Effect.Effect<
  void,
  never,
  | BookmarkRepository
  | ProcessorService
  | JobService
  | EventsService
  | ConfigService
  | LoggingService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const processor = yield* ProcessorService;
    const jobService = yield* JobService;
    const events = yield* EventsService;
    const config = yield* ConfigService;
    const logging = yield* LoggingService;

    const maxRetries = yield* config.get<number>('QUEUE_MAX_RETRIES');
    const baseDelay = yield* config.get<number>('QUEUE_RETRY_BASE_DELAY_MS');
    const maxDelay = yield* config.get<number>('QUEUE_RETRY_MAX_DELAY_MS');
    const currentRetryCount = bookmark.retryCount ?? 0;

    yield* logging.debug(
      `Processing content: ${bookmark.title || bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`
    );

    // Update status to processing
    yield* repo.update(bookmark.id, {
      status: 'processing',
      updatedAt: new Date(),
    });

    yield* jobService.updateJobItemByBookmark(bookmark.id, {
      status: 'in_progress' as JobItemStatus,
    });

    yield* events.bookmarkProcessingStarted(bookmark.id);

    // Process content with error handling
    yield* processor.processContent(bookmark).pipe(
      Effect.matchEffect({
        onSuccess: () =>
          Effect.gen(function* () {
            yield* repo.update(bookmark.id, {
              status: 'complete',
              errorMessage: undefined,
              updatedAt: new Date(),
            });

            yield* jobService.updateJobItemByBookmark(bookmark.id, {
              status: 'complete' as JobItemStatus,
            });

            const jobItem = yield* jobService.getJobItemByBookmark(bookmark.id);
            if (jobItem) {
              yield* jobService.updateJobStatus(jobItem.jobId);
            }

            yield* events.bookmarkReady(bookmark.id);

            yield* logging.info(
              `Completed: ${bookmark.title || bookmark.url}`
            );
          }),
        onFailure: (error) =>
          Effect.gen(function* () {
            const errorMessage = getErrorMessage(error);
            yield* logging.error(
              `Processing error for ${bookmark.id}: ${errorMessage}`
            );

            if (currentRetryCount < maxRetries) {
              const newRetryCount = currentRetryCount + 1;
              const backoffDelay = calculateBackoffDelay(currentRetryCount, {
                baseDelay,
                maxDelay,
              });

              yield* logging.debug(
                `Retrying ${bookmark.id} in ${Math.round(backoffDelay)}ms (attempt ${newRetryCount + 1}/${maxRetries + 1})`
              );

              const retryMessage = `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`;

              yield* repo.update(bookmark.id, {
                status: 'downloaded',
                retryCount: newRetryCount,
                errorMessage: retryMessage,
                updatedAt: new Date(),
              });

              yield* jobService.updateJobItemByBookmark(bookmark.id, {
                status: 'pending' as JobItemStatus,
                retryCount: newRetryCount,
                errorMessage: retryMessage,
              });

              yield* Effect.sleep(`${Math.round(backoffDelay)} millis`);
            } else {
              yield* logging.error(
                `Max retries (${maxRetries}) exceeded for ${bookmark.id}`
              );

              const failureMessage = `Failed after ${maxRetries + 1} attempts: ${errorMessage}`;

              yield* repo.update(bookmark.id, {
                status: 'error',
                errorMessage: failureMessage,
                updatedAt: new Date(),
              });

              yield* jobService.updateJobItemByBookmark(bookmark.id, {
                status: 'error' as JobItemStatus,
                errorMessage: failureMessage,
              });

              const jobItem = yield* jobService.getJobItemByBookmark(
                bookmark.id
              );
              if (jobItem) {
                yield* jobService.updateJobStatus(jobItem.jobId);
              }

              yield* events.bookmarkProcessingFailed(bookmark.id, failureMessage);
            }
          }),
      })
    );
  });
}

/**
 * Process all bookmarks in 'downloaded' or 'pending' status sequentially
 */
function processContentQueue(): Effect.Effect<
  void,
  never,
  | BookmarkRepository
  | ProcessorService
  | JobService
  | EventsService
  | ConfigService
  | LoggingService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const logging = yield* LoggingService;

    yield* logging.info('Starting content processing phase');

    // Process bookmarks one at a time
    while (true) {
      const bookmarks = yield* repo.getByStatus('downloaded', 1).pipe(
        Effect.flatMap((downloaded) =>
          downloaded.length > 0
            ? Effect.succeed(downloaded)
            : repo.getByStatus('pending', 1)
        )
      );

      if (bookmarks.length === 0) {
        yield* logging.debug('No more bookmarks to process');
        break;
      }

      const bookmark = bookmarks[0];
      yield* processSingleBookmarkContent(bookmark);
    }
  });
}

/**
 * Main queue processing orchestrator
 *
 * Maintains global processing state and coordinates the two-phase pipeline:
 * 1. Parallel fetch phase
 * 2. Sequential content processing phase
 * 3. WebDAV sync trigger
 */
export function startProcessingQueue(): Effect.Effect<
  void,
  never,
  | BookmarkRepository
  | FetchService
  | ProcessorService
  | JobService
  | EventsService
  | SyncService
  | ConfigService
  | LoggingService
> {
  return Effect.gen(function* () {
    const logging = yield* LoggingService;
    const sync = yield* SyncService;

    // Create ref for processing state
    const isProcessingRef = yield* Ref.make(false);

    // Check if already processing
    const isProcessing = yield* Ref.get(isProcessingRef);
    if (isProcessing) {
      yield* logging.debug('Already processing, skipping');
      return;
    }

    // Set processing flag
    yield* Ref.set(isProcessingRef, true);
    yield* logging.info('Starting processing queue');

    // Use ensuring to guarantee cleanup
    yield* Effect.gen(function* () {
      // Phase 1: Parallel fetch - download HTML for all 'fetching' bookmarks
      yield* processFetchQueue();

      // Phase 2: Sequential content processing - process 'downloaded' and 'pending' bookmarks
      yield* processContentQueue();

      // Trigger WebDAV sync after queue is empty (ignore errors)
      yield* sync.triggerIfEnabled().pipe(
        Effect.catchAll((error) =>
          logging.error(
            `WebDAV sync after queue empty failed: ${getErrorMessage(error)}`
          )
        )
      );
    }).pipe(
      Effect.ensuring(
        Ref.set(isProcessingRef, false).pipe(
          Effect.flatMap(() =>
            logging.debug('Processing queue finished, flag reset')
          )
        )
      )
    );
  });
}

/**
 * Convenience function to run queue processing with a runtime
 *
 * This can be used for backward compatibility with the original
 * async function signature, or when you have a configured runtime.
 *
 * @example
 * ```typescript
 * import * as Runtime from 'effect/Runtime';
 * import * as Layer from 'effect/Layer';
 *
 * const runtime = Runtime.defaultRuntime;
 * const layer = Layer.mergeAll(
 *   BookmarkRepositoryLive,
 *   FetchServiceLive,
 *   ProcessorServiceLive,
 *   JobServiceLive,
 *   EventsServiceLive,
 *   SyncServiceLive,
 *   ConfigServiceLive,
 *   LoggingServiceLive
 * );
 *
 * await runProcessingQueue(runtime, layer);
 * ```
 */
export function runProcessingQueue<R>(
  runtime: Effect.Runtime.Runtime<never>,
  layer: Effect.Layer.Layer<R, never, never>
): Promise<void> {
  const effect = startProcessingQueue().pipe(
    Effect.provide(layer as Effect.Layer.Layer<
      | BookmarkRepository
      | FetchService
      | ProcessorService
      | JobService
      | EventsService
      | SyncService
      | ConfigService
      | LoggingService,
      never,
      never
    >)
  );

  return Effect.runPromise(effect);
}
