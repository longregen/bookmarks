import { db } from '../db/schema';
import { processBookmark } from './processor';
import { getErrorMessage } from '../lib/errors';
import { triggerSyncIfEnabled } from '../lib/webdav-sync';

let isProcessing = false;

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

      console.log(`Processing bookmark: ${bookmark.title || bookmark.url}`);

      try {
        await db.bookmarks.update(bookmark.id, {
          status: 'processing',
          updatedAt: new Date(),
        });

        await processBookmark(bookmark);

        await db.bookmarks.update(bookmark.id, {
          status: 'complete',
          errorMessage: undefined,
          updatedAt: new Date(),
        });

        console.log(`Completed bookmark: ${bookmark.title || bookmark.url}`);
      } catch (error) {
        console.error(`Error processing bookmark ${bookmark.id}:`, error);

        await db.bookmarks.update(bookmark.id, {
          status: 'error',
          errorMessage: getErrorMessage(error),
          updatedAt: new Date(),
        });
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
