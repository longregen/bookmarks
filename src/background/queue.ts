import { db } from '../db/schema';
import { processBookmark } from './processor';
import { createStateManager } from '../lib/state-manager';
import { shouldRetryBookmark, getNextRetryTime } from '../lib/retry';
import {
  QUEUE_PROCESSING_TIMEOUT_MS,
  QUEUE_STATE_TIMEOUT_MS,
  QUEUE_MAX_RETRIES,
  QUEUE_RETRY_BASE_DELAY_MS,
  QUEUE_RETRY_MAX_DELAY_MS
} from '../lib/constants';

// State manager with timeout for queue processing
const processingState = createStateManager({
  name: 'QueueProcessor',
  timeoutMs: QUEUE_STATE_TIMEOUT_MS,
});

export async function startProcessingQueue() {
  // Try to start processing (returns false if already active)
  if (!processingState.start()) {
    console.log('Queue already processing');
    return;
  }

  try {
    while (true) {
      // Reset bookmarks stuck in 'processing' state for more than 1 minute
      const processingBookmarks = await db.bookmarks
        .where('status')
        .equals('processing')
        .toArray();

      const timeoutThreshold = new Date(Date.now() - QUEUE_PROCESSING_TIMEOUT_MS);
      for (const bookmark of processingBookmarks) {
        // Check if the bookmark has been processing for too long
        if (bookmark.updatedAt < timeoutThreshold) {
          const retryCount = (bookmark.retryCount || 0) + 1;

          if (shouldRetryBookmark(retryCount - 1, QUEUE_MAX_RETRIES)) {
            // Mark for retry with exponential backoff
            const nextRetryAt = getNextRetryTime(retryCount - 1, QUEUE_RETRY_BASE_DELAY_MS, QUEUE_RETRY_MAX_DELAY_MS);
            console.log(`Resetting bookmark ${bookmark.id} (${bookmark.title}) - processing timeout exceeded (retry ${retryCount}/${QUEUE_MAX_RETRIES}, next retry at ${nextRetryAt.toISOString()})`);

            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: 'Processing timeout exceeded',
              retryCount,
              lastRetryAt: new Date(),
              nextRetryAt,
              updatedAt: new Date(),
            });
          } else {
            // Max retries exceeded
            console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${QUEUE_MAX_RETRIES} retries - processing timeout`);
            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: `Processing timeout exceeded after ${QUEUE_MAX_RETRIES} retry attempts`,
              retryCount,
              updatedAt: new Date(),
            });
          }
        }
      }

      // Find bookmarks ready for retry (in error state with nextRetryAt in the past)
      const errorBookmarks = await db.bookmarks
        .where('status')
        .equals('error')
        .toArray();

      const now = new Date();
      const bookmarksReadyForRetry = errorBookmarks.filter(bookmark => {
        // Only retry if we have a nextRetryAt and it's in the past
        if (!bookmark.nextRetryAt) {
          return false;
        }
        return bookmark.nextRetryAt <= now;
      });

      // Reset error bookmarks ready for retry back to pending
      for (const bookmark of bookmarksReadyForRetry) {
        console.log(`Retrying bookmark ${bookmark.id} (${bookmark.title}) - attempt ${(bookmark.retryCount || 0) + 1}/${QUEUE_MAX_RETRIES + 1}`);
        await db.bookmarks.update(bookmark.id, {
          status: 'pending',
          updatedAt: new Date(),
        });
      }

      // Get all pending bookmarks (including newly reset ones)
      const allPending = await db.bookmarks
        .where('status')
        .equals('pending')
        .sortBy('createdAt');

      if (allPending.length === 0) {
        console.log('No pending bookmarks to process');
        // Trigger sync when processing queue is empty (use dynamic import)
        import('../lib/webdav-sync').then(({ triggerSyncIfEnabled }) => {
          triggerSyncIfEnabled().catch(err => {
            console.error('WebDAV sync after queue empty failed:', err);
          });
        }).catch(err => {
          console.error('Failed to load webdav-sync module:', err);
        });
        break;
      }

      const bookmark = allPending[0];
      console.log(`Processing bookmark: ${bookmark.title}`);

      try {
        await processBookmark(bookmark);

        // Success - clear retry tracking
        await db.bookmarks.update(bookmark.id, {
          retryCount: 0,
          lastRetryAt: undefined,
          nextRetryAt: undefined,
        });
      } catch (error) {
        const retryCount = (bookmark.retryCount || 0) + 1;
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error(`Error processing bookmark ${bookmark.id} (attempt ${retryCount}/${QUEUE_MAX_RETRIES + 1}):`, error);

        // Check if we should retry
        if (shouldRetryBookmark(retryCount - 1, QUEUE_MAX_RETRIES)) {
          // Schedule retry with exponential backoff
          const nextRetryAt = getNextRetryTime(retryCount - 1, QUEUE_RETRY_BASE_DELAY_MS, QUEUE_RETRY_MAX_DELAY_MS);
          const delaySeconds = Math.round((nextRetryAt.getTime() - Date.now()) / 1000);

          console.log(`Will retry bookmark ${bookmark.id} in ${delaySeconds}s (attempt ${retryCount}/${QUEUE_MAX_RETRIES + 1})`);

          await db.bookmarks.update(bookmark.id, {
            retryCount,
            lastRetryAt: new Date(),
            nextRetryAt,
            updatedAt: new Date(),
          });
        } else {
          // Max retries exceeded - mark as permanent error
          console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${QUEUE_MAX_RETRIES} retry attempts: ${errorMessage}`);

          await db.bookmarks.update(bookmark.id, {
            errorMessage: `Failed after ${QUEUE_MAX_RETRIES} retry attempts: ${errorMessage}`,
            retryCount,
            lastRetryAt: new Date(),
            nextRetryAt: undefined, // Clear nextRetryAt to prevent further retries
            updatedAt: new Date(),
          });
        }
      }
    }
  } finally {
    processingState.reset();
  }
}
