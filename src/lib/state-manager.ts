import { db } from '../db/schema';
import { config } from './config-registry';

/**
 * Checks for bookmarks stuck in 'processing' status and resets them to 'pending'.
 * A bookmark is considered stuck if it has been in 'processing' state for longer
 * than QUEUE_PROCESSING_TIMEOUT_MS.
 *
 * This function should be called on service worker startup to recover from
 * interrupted processing (e.g., service worker termination, browser crash).
 *
 * @returns The number of bookmarks that were reset
 */
export async function resetStuckBookmarks(): Promise<number> {
  const timeout = config.QUEUE_PROCESSING_TIMEOUT_MS;
  const cutoffTime = new Date(Date.now() - timeout);

  // Use compound index [status+updatedAt] for efficient range query
  const stuckBookmarks = await db.bookmarks
    .where('[status+updatedAt]')
    .between(['processing', new Date(0)], ['processing', cutoffTime])
    .toArray();

  if (stuckBookmarks.length === 0) {
    return 0;
  }

  console.log(`[StateManager] Found ${stuckBookmarks.length} stuck bookmarks, resetting to pending`);

  const now = new Date();
  await Promise.all(
    stuckBookmarks.map(bookmark =>
      db.bookmarks.update(bookmark.id, {
        status: 'pending',
        updatedAt: now,
      })
    )
  );

  return stuckBookmarks.length;
}
