import { db, JobItemStatus } from '../db/schema';
import { processBookmark } from './processor';
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
  // Add jitter (0-25% of delay)
  return delay + Math.random() * delay * 0.25;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

export async function startProcessingQueue(): Promise<void> {
  if (isProcessing) {
    console.log('Queue already processing, skipping');
    return;
  }

  isProcessing = true;
  console.log('Starting processing queue');

  try {
    for (;;) {
      const bookmark = await db.bookmarks
        .where('status')
        .anyOf(['pending', 'fetching'])
        .first();

      if (!bookmark) {
        console.log('No bookmarks to process');
        break;
      }

      const currentRetryCount = bookmark.retryCount ?? 0;
      const maxRetries = config.QUEUE_MAX_RETRIES;

      console.log(`Processing bookmark: ${bookmark.title || bookmark.url} (attempt ${currentRetryCount + 1}/${maxRetries + 1})`);

      try {
        await db.bookmarks.update(bookmark.id, {
          status: 'processing',
          updatedAt: new Date(),
        });

        // Update job item status
        await updateJobItemByBookmark(bookmark.id, {
          status: JobItemStatus.IN_PROGRESS,
        });

        await processBookmark(bookmark);

        await db.bookmarks.update(bookmark.id, {
          status: 'complete',
          errorMessage: undefined,
          updatedAt: new Date(),
        });

        // Update job item status to complete
        await updateJobItemByBookmark(bookmark.id, {
          status: JobItemStatus.COMPLETE,
        });

        // Update parent job status
        const jobItem = await getJobItemByBookmark(bookmark.id);
        if (jobItem) {
          await updateJobStatus(jobItem.jobId);
        }

        console.log(`Completed bookmark: ${bookmark.title || bookmark.url}`);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error(`Error processing bookmark ${bookmark.id}:`, error);

        if (currentRetryCount < maxRetries) {
          // Retry with exponential backoff
          const newRetryCount = currentRetryCount + 1;
          const backoffDelay = calculateBackoffDelay(currentRetryCount);

          console.log(`Retrying bookmark ${bookmark.id} in ${Math.round(backoffDelay)}ms (attempt ${newRetryCount + 1}/${maxRetries + 1})`);

          await db.bookmarks.update(bookmark.id, {
            status: 'fetching', // Reset to fetching for retry
            retryCount: newRetryCount,
            errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
            updatedAt: new Date(),
          });

          // Update job item with retry info
          await updateJobItemByBookmark(bookmark.id, {
            status: JobItemStatus.PENDING,
            retryCount: newRetryCount,
            errorMessage: `Retry ${newRetryCount}/${maxRetries}: ${errorMessage}`,
          });

          // Wait before continuing (the bookmark will be picked up again)
          await sleep(backoffDelay);
        } else {
          // Max retries exceeded, mark as error
          console.error(`Max retries (${maxRetries}) exceeded for bookmark ${bookmark.id}`);

          await db.bookmarks.update(bookmark.id, {
            status: 'error',
            errorMessage: `Failed after ${maxRetries + 1} attempts: ${errorMessage}`,
            updatedAt: new Date(),
          });

          // Update job item status to error
          await updateJobItemByBookmark(bookmark.id, {
            status: JobItemStatus.ERROR,
            errorMessage: `Failed after ${maxRetries + 1} attempts: ${errorMessage}`,
          });

          // Update parent job status
          const jobItem = await getJobItemByBookmark(bookmark.id);
          if (jobItem) {
            await updateJobStatus(jobItem.jobId);
          }
        }
      }
    }

    // Trigger WebDAV sync after queue is empty
    triggerSyncIfEnabled().catch((err: unknown) => {
      console.error('WebDAV sync after queue empty failed:', err);
    });
  } finally {
    isProcessing = false;
  }
}
