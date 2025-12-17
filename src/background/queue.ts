import { db } from '../db/schema';
import { processBookmark } from './processor';
import { createStateManager } from '../lib/state-manager';
import { shouldRetryBookmark, getNextRetryTime } from '../lib/retry';
import { config } from '../lib/config-registry';
import { getErrorMessage } from '../lib/errors';

const processingState = createStateManager({
  name: 'QueueProcessor',
  timeoutMs: config.QUEUE_STATE_TIMEOUT_MS,
});

async function updateBookmarkWithRetry(
  bookmarkId: string,
  errorMessage: string,
  currentRetryCount: number
): Promise<void> {
  const retryCount = currentRetryCount + 1;
  const canRetry = shouldRetryBookmark(retryCount - 1, config.QUEUE_MAX_RETRIES);

  if (canRetry) {
    const nextRetryAt = getNextRetryTime(retryCount - 1, config.QUEUE_RETRY_BASE_DELAY_MS, config.QUEUE_RETRY_MAX_DELAY_MS);
    await db.bookmarks.update(bookmarkId, {
      status: 'error',
      errorMessage,
      retryCount,
      lastRetryAt: new Date(),
      nextRetryAt,
      updatedAt: new Date(),
    });
  } else {
    await db.bookmarks.update(bookmarkId, {
      status: 'error',
      errorMessage: `Failed after ${config.QUEUE_MAX_RETRIES} retry attempts: ${errorMessage}`,
      retryCount,
      lastRetryAt: new Date(),
      nextRetryAt: undefined,
      updatedAt: new Date(),
    });
  }
}

export async function startProcessingQueue() {
  if (!processingState.start()) {
    console.log('Queue already processing');
    return;
  }

  try {
    while (true) {
      const processingBookmarks = await db.bookmarks
        .where('status')
        .equals('processing')
        .toArray();

      const timeoutThreshold = new Date(Date.now() - config.QUEUE_PROCESSING_TIMEOUT_MS);
      for (const bookmark of processingBookmarks) {
        if (bookmark.updatedAt < timeoutThreshold) {
          const retryCount = (bookmark.retryCount || 0) + 1;

          if (shouldRetryBookmark(retryCount - 1, config.QUEUE_MAX_RETRIES)) {
            const nextRetryAt = getNextRetryTime(retryCount - 1, config.QUEUE_RETRY_BASE_DELAY_MS, config.QUEUE_RETRY_MAX_DELAY_MS);
            console.log(`Resetting bookmark ${bookmark.id} (${bookmark.title}) - processing timeout exceeded (retry ${retryCount}/${config.QUEUE_MAX_RETRIES}, next retry at ${nextRetryAt.toISOString()})`);
          } else {
            console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${config.QUEUE_MAX_RETRIES} retries - processing timeout`);
          }

          await updateBookmarkWithRetry(
            bookmark.id,
            'Processing timeout exceeded',
            bookmark.retryCount || 0
          );
        }
      }

      const errorBookmarks = await db.bookmarks
        .where('status')
        .equals('error')
        .toArray();

      const now = new Date();
      const bookmarksReadyForRetry = errorBookmarks.filter(bookmark => {
        if (!bookmark.nextRetryAt) {
          return false;
        }
        return bookmark.nextRetryAt <= now;
      });

      for (const bookmark of bookmarksReadyForRetry) {
        console.log(`Retrying bookmark ${bookmark.id} (${bookmark.title}) - attempt ${(bookmark.retryCount || 0) + 1}/${config.QUEUE_MAX_RETRIES + 1}`);
        await db.bookmarks.update(bookmark.id, {
          status: 'pending',
          updatedAt: new Date(),
        });
      }

      const allPending = await db.bookmarks
        .where('status')
        .equals('pending')
        .sortBy('createdAt');

      if (allPending.length === 0) {
        console.log('No pending bookmarks to process');
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

        await db.bookmarks.update(bookmark.id, {
          retryCount: 0,
          lastRetryAt: undefined,
          nextRetryAt: undefined,
        });
      } catch (error) {
        const retryCount = (bookmark.retryCount || 0) + 1;
        const errorMessage = getErrorMessage(error);

        console.error(`Error processing bookmark ${bookmark.id} (attempt ${retryCount}/${config.QUEUE_MAX_RETRIES + 1}):`, error);

        if (shouldRetryBookmark(retryCount - 1, config.QUEUE_MAX_RETRIES)) {
          const nextRetryAt = getNextRetryTime(retryCount - 1, config.QUEUE_RETRY_BASE_DELAY_MS, config.QUEUE_RETRY_MAX_DELAY_MS);
          const delaySeconds = Math.round((nextRetryAt.getTime() - Date.now()) / 1000);

          console.log(`Will retry bookmark ${bookmark.id} in ${delaySeconds}s (attempt ${retryCount}/${config.QUEUE_MAX_RETRIES + 1})`);
        } else {
          console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${config.QUEUE_MAX_RETRIES} retry attempts: ${errorMessage}`);
        }

        await updateBookmarkWithRetry(
          bookmark.id,
          errorMessage,
          bookmark.retryCount || 0
        );
      }
    }
  } finally {
    processingState.reset();
  }
}
