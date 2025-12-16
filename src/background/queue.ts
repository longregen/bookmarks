import { db } from '../db/schema';
import { processBookmark } from './processor';
import { shouldRetry, categorizeError, calculateBackoff, DEFAULT_RETRY_CONFIG, ErrorCategory } from '../lib/retry';
import { LOCK_TIMEOUT_MS, PROCESSING_TIMEOUT_MS } from '../lib/constants';
import * as crypto from 'crypto';

// Session ID to detect stale locks from previous service worker instances
const SESSION_ID = `session-${Date.now()}-${crypto.randomBytes(9).toString('hex')}`;

// Processing lock state with timestamp and session validation
interface ProcessingLock {
  isLocked: boolean;
  timestamp: number;
  sessionId: string;
}

let processingLock: ProcessingLock = {
  isLocked: false,
  timestamp: 0,
  sessionId: SESSION_ID,
};

/**
 * Check if the current lock is stale (timed out or from a previous session)
 */
function isLockStale(lock: ProcessingLock): boolean {
  // Lock is stale if it's from a different session
  if (lock.sessionId !== SESSION_ID) {
    console.log('Processing lock is from a different session, treating as stale');
    return true;
  }

  // Lock is stale if it's been held for more than LOCK_TIMEOUT_MS
  const lockAge = Date.now() - lock.timestamp;
  if (lockAge > LOCK_TIMEOUT_MS) {
    console.log(`Processing lock has timed out (${Math.round(lockAge / 1000)}s old), treating as stale`);
    return true;
  }

  return false;
}

/**
 * Acquire the processing lock
 */
function acquireLock(): boolean {
  if (processingLock.isLocked && !isLockStale(processingLock)) {
    return false; // Lock is held and valid
  }

  // Acquire or reset the lock
  processingLock = {
    isLocked: true,
    timestamp: Date.now(),
    sessionId: SESSION_ID,
  };
  return true;
}

/**
 * Release the processing lock
 */
function releaseLock(): void {
  processingLock = {
    isLocked: false,
    timestamp: Date.now(),
    sessionId: SESSION_ID,
  };
}

export async function startProcessingQueue() {
  if (!acquireLock()) {
    console.log('Queue already processing');
    return;
  }

  try {
    while (true) {
      // Find the next pending bookmark
      const pendingBookmarks = await db.bookmarks
        .where('status')
        .equals('pending')
        .toArray();

      // Reset bookmarks stuck in 'processing' state for more than 1 minute
      const processingBookmarks = await db.bookmarks
        .where('status')
        .equals('processing')
        .toArray();

      const processingTimeoutAgo = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
      for (const bookmark of processingBookmarks) {
        // Check if the bookmark has been processing for too long
        if (bookmark.updatedAt < processingTimeoutAgo) {
          console.log(`Resetting bookmark ${bookmark.id} (${bookmark.title}) - processing timeout exceeded`);
          await db.bookmarks.update(bookmark.id, {
            status: 'pending',
            updatedAt: new Date(),
          });
        }
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
      } catch (error) {
        console.error(`Error processing bookmark ${bookmark.id}:`, error);

        // Get updated bookmark to check current state (processor may have updated it)
        const updatedBookmark = await db.bookmarks.get(bookmark.id);
        if (!updatedBookmark) {
          console.error(`Bookmark ${bookmark.id} not found after processing error`);
          continue;
        }

        // Only implement retry logic if bookmark is in 'error' state
        // (processor sets it to 'error' when it fails)
        if (updatedBookmark.status === 'error') {
          const currentRetryCount = updatedBookmark.retryCount || 0;
          const errorCategory = categorizeError(error);

          // Check if we should retry
          if (shouldRetry(error, currentRetryCount, DEFAULT_RETRY_CONFIG)) {
            const newRetryCount = currentRetryCount + 1;
            const backoffMs = calculateBackoff(currentRetryCount, DEFAULT_RETRY_CONFIG);

            console.log(
              `Scheduling retry ${newRetryCount}/${DEFAULT_RETRY_CONFIG.maxRetries} for bookmark ${bookmark.id}`,
              `(${bookmark.title}) after ${backoffMs}ms backoff. Error category: ${errorCategory}`
            );

            // Reset to pending with incremented retry count after backoff
            setTimeout(async () => {
              try {
                await db.bookmarks.update(bookmark.id, {
                  status: 'pending',
                  retryCount: newRetryCount,
                  updatedAt: new Date(),
                });
                console.log(`Bookmark ${bookmark.id} reset to pending for retry ${newRetryCount}`);

                // Restart processing queue to pick up the retry
                startProcessingQueue();
              } catch (updateError) {
                console.error(`Failed to reset bookmark ${bookmark.id} for retry:`, updateError);
              }
            }, backoffMs);
          } else {
            // Max retries exceeded or fatal error
            if (currentRetryCount >= DEFAULT_RETRY_CONFIG.maxRetries) {
              console.error(
                `Max retries (${DEFAULT_RETRY_CONFIG.maxRetries}) exceeded for bookmark ${bookmark.id} (${bookmark.title}). Giving up.`
              );
            } else {
              console.error(
                `Fatal error (${errorCategory}) for bookmark ${bookmark.id} (${bookmark.title}). Not retrying.`
              );
            }
            // Bookmark remains in 'error' state
          }
        }
      }
    }
  } catch (error) {
    console.error('Queue processing error:', error);
    throw error;
  } finally {
    releaseLock();
  }
}
