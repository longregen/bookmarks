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

      // Reset any bookmarks stuck in 'processing' state (from interrupted service worker)
      const processingBookmarks = await db.bookmarks
        .where('status')
        .equals('processing')
        .toArray();

      for (const bookmark of processingBookmarks) {
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
