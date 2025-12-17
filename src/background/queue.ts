import { db, JobItemStatus, type Bookmark } from '../db/schema';
import { fetchBookmarkHtml, processBookmarkContent } from './processor';
import { getErrorMessage } from '../lib/errors';
import { triggerSyncIfEnabled } from '../lib/webdav-sync';
import { config } from '../lib/config-registry';
import {
  updateJobItemByBookmark,
  getJobItemByBookmark,
  updateJobStatus,
} from '../lib/jobs';

let isProcessing = false;

function calculateBackoffDelay(retryCount: number): number {
  const baseDelay = config.QUEUE_RETRY_BASE_DELAY_MS;
  const maxDelay = config.QUEUE_RETRY_MAX_DELAY_MS;
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  return delay + Math.random() * delay * 0.25;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function fetchSingleBookmark(bookmark: Bookmark): Promise<{ success: boolean; bookmark: Bookmark }> {
  const currentRetryCount = bookmark.retryCount ?? 0;
  const maxRetries = config.QUEUE_MAX_RETRIES;

  try {
    console.log(`[Queue] Fetching: ${bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`);

    const fetchedBookmark = await fetchBookmarkHtml(bookmark);

    console.log(`[Queue] Downloaded: ${fetchedBookmark.title}`);
    return { success: true, bookmark: fetchedBookmark };
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

    return { success: false, bookmark };
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

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    console.log(`[Queue] Batch complete: ${successCount} succeeded, ${failureCount} failed/retrying`);

    // Small delay between batches to avoid overwhelming the system
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

      console.log(`[Queue] Completed: ${bookmark.title || bookmark.url}`);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`[Queue] Processing error for ${bookmark.id}:`, error);

      if (currentRetryCount < maxRetries) {
        const newRetryCount = currentRetryCount + 1;
        const backoffDelay = calculateBackoffDelay(currentRetryCount);

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
    }
  }
}

export async function startProcessingQueue(): Promise<void> {
  if (isProcessing) {
    console.log('[Queue] Already processing, skipping');
    return;
  }

  isProcessing = true;
  console.log('[Queue] Starting processing queue');

  try {
    // Phase 1: Parallel fetch - download HTML for all 'fetching' bookmarks
    await processFetchQueue();

    // Phase 2: Sequential content processing - process 'downloaded' and 'pending' bookmarks
    await processContentQueue();

    // Trigger WebDAV sync after queue is empty
    triggerSyncIfEnabled().catch((err: unknown) => {
      console.error('[Queue] WebDAV sync after queue empty failed:', err);
    });
  } finally {
    isProcessing = false;
  }
}
