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

export async function startProcessingQueue(): Promise<void> {
  if (!processingState.start()) {
    console.log('Queue already processing');
    return;
  }

  // Extract config values once to avoid repeated property access
  const maxRetries = config.QUEUE_MAX_RETRIES;
  const retryBaseDelayMs = config.QUEUE_RETRY_BASE_DELAY_MS;
  const retryMaxDelayMs = config.QUEUE_RETRY_MAX_DELAY_MS;
  const processingTimeoutMs = config.QUEUE_PROCESSING_TIMEOUT_MS;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const processingBookmarks = await db.bookmarks
        .where('status')
        .equals('processing')
        .toArray();

      const timeoutThreshold = new Date(Date.now() - processingTimeoutMs);
      for (const bookmark of processingBookmarks) {
        if (bookmark.updatedAt < timeoutThreshold) {
          const currentRetryCount = bookmark.retryCount ?? 0;
          const newRetryCount = currentRetryCount + 1;
          const canRetry = shouldRetryBookmark(currentRetryCount, maxRetries);

          if (canRetry) {
            const nextRetryAt = getNextRetryTime(currentRetryCount, retryBaseDelayMs, retryMaxDelayMs);
            console.log(`Resetting bookmark ${bookmark.id} (${bookmark.title}) - processing timeout exceeded (retry ${newRetryCount}/${maxRetries}, next retry at ${nextRetryAt.toISOString()})`);

            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: 'Processing timeout exceeded',
              retryCount: newRetryCount,
              lastRetryAt: new Date(),
              nextRetryAt,
              updatedAt: new Date(),
            });
          } else {
            console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${maxRetries} retries - processing timeout`);

            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: `Failed after ${maxRetries} retry attempts: Processing timeout exceeded`,
              retryCount: newRetryCount,
              lastRetryAt: new Date(),
              nextRetryAt: undefined,
              updatedAt: new Date(),
            });
          }
        }
      }

      const errorBookmarks = await db.bookmarks
        .where('status')
        .equals('error')
        .toArray();

      const now = new Date();
      const bookmarksReadyForRetry = errorBookmarks.filter(
        bookmark => bookmark.nextRetryAt !== undefined && bookmark.nextRetryAt <= now
      );

      for (const bookmark of bookmarksReadyForRetry) {
        console.log(`Retrying bookmark ${bookmark.id} (${bookmark.title}) - attempt ${(bookmark.retryCount ?? 0) + 1}/${maxRetries + 1}`);
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
          triggerSyncIfEnabled().catch((err: unknown) => {
            console.error('WebDAV sync after queue empty failed:', err);
          });
        }).catch((err: unknown) => {
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
        const currentRetryCount = bookmark.retryCount ?? 0;
        const newRetryCount = currentRetryCount + 1;
        const errorMessage = getErrorMessage(error);

        console.error(`Error processing bookmark ${bookmark.id} (attempt ${newRetryCount}/${maxRetries + 1}):`, error);

        const canRetry = shouldRetryBookmark(currentRetryCount, maxRetries);

        if (canRetry) {
          const nextRetryAt = getNextRetryTime(currentRetryCount, retryBaseDelayMs, retryMaxDelayMs);
          const delaySeconds = Math.round((nextRetryAt.getTime() - Date.now()) / 1000);

          console.log(`Will retry bookmark ${bookmark.id} in ${delaySeconds}s (attempt ${newRetryCount}/${maxRetries + 1})`);

          await db.bookmarks.update(bookmark.id, {
            status: 'error',
            errorMessage,
            retryCount: newRetryCount,
            lastRetryAt: new Date(),
            nextRetryAt,
            updatedAt: new Date(),
          });
        } else {
          console.error(`Bookmark ${bookmark.id} (${bookmark.title}) failed permanently after ${maxRetries} retry attempts: ${errorMessage}`);

          await db.bookmarks.update(bookmark.id, {
            status: 'error',
            errorMessage: `Failed after ${maxRetries} retry attempts: ${errorMessage}`,
            retryCount: newRetryCount,
            lastRetryAt: new Date(),
            nextRetryAt: undefined,
            updatedAt: new Date(),
          });
        }
      }
    }
  } finally {
    processingState.reset();
  }
}
