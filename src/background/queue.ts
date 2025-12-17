import { db } from '../db/schema';
import { processBookmark } from './processor';
import { getErrorMessage } from '../lib/errors';

let isProcessing = false;

export async function startProcessingQueue(): Promise<void> {
  if (isProcessing) {
    console.log('Queue already processing, skipping');
    return;
  }

  isProcessing = true;
  console.log('Starting processing queue');

  try {
    while (true) {
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
    import('../lib/webdav-sync')
      .then(({ triggerSyncIfEnabled }) => {
        triggerSyncIfEnabled().catch((err: unknown) => {
          console.error('WebDAV sync after queue empty failed:', err);
        });
      })
      .catch((err: unknown) => {
        console.error('Failed to load webdav-sync module:', err);
      });
  } finally {
    isProcessing = false;
  }
}
