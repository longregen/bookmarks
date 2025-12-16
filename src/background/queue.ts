import { db } from '../db/schema';
import { processBookmark } from './processor';

let isProcessing = false;

export async function startProcessingQueue() {
  if (isProcessing) {
    console.log('Queue already processing');
    return;
  }

  isProcessing = true;

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

      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      for (const bookmark of processingBookmarks) {
        // Check if the bookmark has been processing for more than 1 minute
        if (bookmark.updatedAt < oneMinuteAgo) {
          console.log(`Resetting bookmark ${bookmark.id} (${bookmark.title}) - processing timeout exceeded (1 minute)`);
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
      }
    }
  } finally {
    isProcessing = false;
  }
}
