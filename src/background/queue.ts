import { db, JobItemStatus, type Bookmark } from '../db/schema';
import { fetchBookmarkHtml, processBookmarkContent } from './processor';
import { getErrorMessage } from '../lib/errors';
import { serverSync } from '../lib/server-sync';
import { config } from '../lib/config-registry';
import {
  updateJobItemByBookmark,
  getJobItemByBookmark,
  updateJobStatus,
} from '../lib/jobs';
import { events } from '../lib/events';
import { sleep } from '../lib/time';

let isProcessing = false;

async function fetchSingleBookmark(bookmark: Bookmark): Promise<boolean> {
  const currentRetryCount = bookmark.retryCount ?? 0;
  const maxRetries = config.QUEUE_MAX_RETRIES;

  try {
    console.log(`[Queue] Fetching: ${bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`);

    const fetchedBookmark = await fetchBookmarkHtml(bookmark);

    console.log(`[Queue] Downloaded: ${fetchedBookmark.title}`);
    return true;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`[Queue] Fetch error for ${bookmark.url}:`, errorMessage);

    if (currentRetryCount < maxRetries) {
      const newRetryCount = currentRetryCount + 1;

      await db.bookmarks.update(bookmark.id, {
        status: 'fetching',
        retryCount: newRetryCount,
        errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
        updatedAt: new Date(),
      });
      await updateJobItemByBookmark(bookmark.id, {
        status: JobItemStatus.PENDING,
        retryCount: newRetryCount,
        errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
      });
    } else {
      await db.bookmarks.update(bookmark.id, {
        status: 'error',
        errorMessage: `Failed after ${maxRetries + 1} attempts: ${errorMessage}`,
        updatedAt: new Date(),
      });
      await updateJobItemByBookmark(bookmark.id, {
        status: JobItemStatus.ERROR,
        errorMessage: `Failed after ${maxRetries + 1} attempts: ${errorMessage}`,
      });
      const jobItem = await getJobItemByBookmark(bookmark.id);
      if (jobItem) {
        await updateJobStatus(jobItem.jobId);
      }
    }

    return false;
  }
}

async function processFetchQueue(): Promise<void> {
  const concurrency = config.FETCH_CONCURRENCY;
  console.log(`[Queue] Starting parallel fetch phase (concurrency: ${concurrency})`);

  for (;;) {
    const bookmarksToFetch = await db.bookmarks
      .where('status')
      .equals('fetching')
      .limit(concurrency)
      .toArray();

    if (bookmarksToFetch.length === 0) {
      console.log('[Queue] No more bookmarks to fetch');
      break;
    }

    console.log(`[Queue] Fetching ${bookmarksToFetch.length} bookmarks in parallel`);

    const results = await Promise.all(
      bookmarksToFetch.map(bookmark => fetchSingleBookmark(bookmark))
    );

    const successCount = results.filter(r => r).length;
    const failureCount = results.length - successCount;
    console.log(`[Queue] Batch complete: ${successCount} succeeded, ${failureCount} failed/retrying`);

    if (bookmarksToFetch.length === concurrency) {
      await sleep(100);
    }
  }
}

async function processContentQueue(): Promise<void> {
  console.log('[Queue] Starting content processing phase');

  for (;;) {
    const bookmark = await db.bookmarks
      .where('status')
      .anyOf(['downloaded', 'pending'])
      .first();

    if (!bookmark) {
      console.log('[Queue] No more bookmarks to process');
      break;
    }

    const currentRetryCount = bookmark.retryCount ?? 0;
    const maxRetries = config.QUEUE_MAX_RETRIES;

    console.log(`[Queue] Processing content: ${bookmark.title || bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`);

    try {
      await db.bookmarks.update(bookmark.id, {
        status: 'processing',
        updatedAt: new Date(),
      });

      await updateJobItemByBookmark(bookmark.id, {
        status: JobItemStatus.IN_PROGRESS,
      });

      await events.bookmark.processingStarted(bookmark.id);

      await processBookmarkContent(bookmark);

      await db.bookmarks.update(bookmark.id, {
        status: 'complete',
        errorMessage: undefined,
        updatedAt: new Date(),
      });

      await updateJobItemByBookmark(bookmark.id, {
        status: JobItemStatus.COMPLETE,
      });

      const jobItem = await getJobItemByBookmark(bookmark.id);
      if (jobItem) {
        await updateJobStatus(jobItem.jobId);
      }

      await events.bookmark.ready(bookmark.id);

      console.log(`[Queue] Completed: ${bookmark.title || bookmark.url}`);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`[Queue] Processing error for ${bookmark.id}:`, error);

      if (currentRetryCount < maxRetries) {
        const newRetryCount = currentRetryCount + 1;
        const baseDelay = config.QUEUE_RETRY_BASE_DELAY_MS;
        const maxDelay = config.QUEUE_RETRY_MAX_DELAY_MS;
        const delay = Math.min(baseDelay * Math.pow(2, currentRetryCount), maxDelay);
        const backoffDelay = delay + Math.random() * delay * 0.25;

        console.log(`[Queue] Retrying ${bookmark.id} in ${Math.round(backoffDelay)}ms (attempt ${newRetryCount + 1}/${maxRetries + 1})`);

        await db.bookmarks.update(bookmark.id, {
          status: 'downloaded',
          retryCount: newRetryCount,
          errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
          updatedAt: new Date(),
        });

        await updateJobItemByBookmark(bookmark.id, {
          status: JobItemStatus.PENDING,
          retryCount: newRetryCount,
          errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
        });

        await sleep(backoffDelay);
      } else {
        console.error(`[Queue] Max retries (${maxRetries}) exceeded for ${bookmark.id}`);

        const failureMessage = `Failed after ${maxRetries + 1} attempts: ${errorMessage}`;

        await db.bookmarks.update(bookmark.id, {
          status: 'error',
          errorMessage: failureMessage,
          updatedAt: new Date(),
        });

        await updateJobItemByBookmark(bookmark.id, {
          status: JobItemStatus.ERROR,
          errorMessage: failureMessage,
        });

        const jobItem = await getJobItemByBookmark(bookmark.id);
        if (jobItem) {
          await updateJobStatus(jobItem.jobId);
        }

        await events.bookmark.processingFailed(bookmark.id, failureMessage);
      }
    }
  }
}

let pendingRestart = false;

export async function startProcessingQueue(): Promise<void> {
  if (isProcessing) {
    pendingRestart = true;
    return;
  }

  isProcessing = true;

  try {
    do {
      pendingRestart = false;
      await processFetchQueue();
      await processContentQueue();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pendingRestart is set by concurrent calls during awaits
    } while (pendingRestart);

    try {
      await serverSync.incrementalSync();
    } catch (err: unknown) {
      console.error('[Queue] Server sync after queue empty failed:', err);
    }
  } finally {
    isProcessing = false;
  }
}
