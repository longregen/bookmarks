import { db, JobItemStatus } from '../db/schema';

export async function resumeIncompleteJobs(): Promise<void> {
  console.log('[JobResumption] Checking for incomplete jobs...');

  const now = new Date();

  const processingBookmarks = await db.bookmarks
    .where('status')
    .equals('processing')
    .toArray();

  if (processingBookmarks.length === 0) {
    console.log('[JobResumption] No incomplete bookmarks found');
  } else {
    console.log(`[JobResumption] Found ${processingBookmarks.length} bookmarks stuck in 'processing' state`);

    await db.transaction('rw', db.bookmarks, async () => {
      await Promise.all(processingBookmarks.map(bookmark =>
        db.bookmarks.update(bookmark.id, {
          status: 'downloaded',
          updatedAt: now,
        })
      ));
    });

    console.log(`[JobResumption] Reset ${processingBookmarks.length} bookmarks to 'downloaded' status`);
  }

  const inProgressJobItems = await db.jobItems
    .where('status')
    .equals(JobItemStatus.IN_PROGRESS)
    .toArray();

  if (inProgressJobItems.length === 0) {
    console.log('[JobResumption] No incomplete job items found');
  } else {
    console.log(`[JobResumption] Found ${inProgressJobItems.length} job items stuck in IN_PROGRESS state`);

    await db.transaction('rw', db.jobItems, async () => {
      await Promise.all(inProgressJobItems.map(item =>
        db.jobItems.update(item.id, {
          status: JobItemStatus.PENDING,
          updatedAt: now,
        })
      ));
    });

    console.log(`[JobResumption] Reset ${inProgressJobItems.length} job items to PENDING status`);
  }

  console.log('[JobResumption] Job resumption complete');
}
