/**
 * Utilities for retry logic and failure handling
 * Reduces duplication in queue.ts retry patterns
 */

import * as Effect from 'effect/Effect';
import type { Bookmark, JobItemStatus } from '../../../src/db/schema';
import { getErrorMessage } from '../../lib/errors';
import type { BookmarkRepository, JobService, EventsService } from '../queue';
import { calculateBackoffDelay } from '../../lib/retry';

export interface RetryConfig {
  maxRetries: number;
  baseDelay?: number;
  maxDelay?: number;
}

export interface RetryContext {
  bookmark: Bookmark;
  currentRetryCount: number;
  maxRetries: number;
}

/**
 * Handle retry logic for bookmark operations
 * Updates bookmark and job item with retry information
 */
export function handleRetry(
  context: RetryContext,
  error: unknown,
  nextStatus: Bookmark['status'],
  options?: { useBackoff?: boolean; baseDelay?: number; maxDelay?: number }
): Effect.Effect<
  void,
  never,
  BookmarkRepository | JobService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const jobService = yield* JobService;

    const { bookmark, currentRetryCount, maxRetries } = context;
    const errorMessage = getErrorMessage(error);
    const newRetryCount = currentRetryCount + 1;
    const retryMessage = `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`;

    yield* repo.update(bookmark.id, {
      status: nextStatus,
      retryCount: newRetryCount,
      errorMessage: retryMessage,
      updatedAt: new Date(),
    });

    yield* jobService.updateJobItemByBookmark(bookmark.id, {
      status: 'pending' as JobItemStatus,
      retryCount: newRetryCount,
      errorMessage: retryMessage,
    });

    // Apply backoff delay if requested
    if (options?.useBackoff) {
      const backoffDelay = calculateBackoffDelay(currentRetryCount, {
        baseDelay: options.baseDelay ?? 1000,
        maxDelay: options.maxDelay ?? 60000,
      });
      yield* Effect.sleep(`${Math.round(backoffDelay)} millis`);
    }
  });
}

/**
 * Handle final failure after max retries exceeded
 * Updates bookmark and job item with error status
 */
export function handleFinalFailure(
  context: RetryContext,
  error: unknown
): Effect.Effect<
  void,
  never,
  BookmarkRepository | JobService | EventsService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const jobService = yield* JobService;
    const events = yield* EventsService;

    const { bookmark, maxRetries } = context;
    const errorMessage = getErrorMessage(error);
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

    const jobItem = yield* jobService.getJobItemByBookmark(bookmark.id);
    if (jobItem) {
      yield* jobService.updateJobStatus(jobItem.jobId);
    }

    yield* events.bookmarkProcessingFailed(bookmark.id, failureMessage);
  });
}

/**
 * Handle completion of bookmark processing
 * Updates bookmark and job item with complete status
 */
export function handleSuccess(
  bookmark: Bookmark
): Effect.Effect<
  void,
  never,
  BookmarkRepository | JobService | EventsService
> {
  return Effect.gen(function* () {
    const repo = yield* BookmarkRepository;
    const jobService = yield* JobService;
    const events = yield* EventsService;

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
  });
}

/**
 * Orchestrate retry or failure based on retry count
 */
export function handleErrorWithRetry(
  context: RetryContext,
  error: unknown,
  nextStatus: Bookmark['status'],
  options?: { useBackoff?: boolean; baseDelay?: number; maxDelay?: number }
): Effect.Effect<
  boolean,
  never,
  BookmarkRepository | JobService | EventsService
> {
  return Effect.gen(function* () {
    const { currentRetryCount, maxRetries } = context;

    if (currentRetryCount < maxRetries) {
      yield* handleRetry(context, error, nextStatus, options);
      return false; // Not final failure
    } else {
      yield* handleFinalFailure(context, error);
      return true; // Final failure
    }
  });
}
