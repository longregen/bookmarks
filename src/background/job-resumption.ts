import { db, JobItemStatus } from '../db/schema';

/**
 * Resume incomplete jobs when the service worker restarts.
 *
 * Finds bookmarks stuck in 'processing' state and resets them to 'downloaded'
 * so the queue picks them up again. Also resets corresponding job items from
 * IN_PROGRESS to PENDING status.
 */
export async function resumeIncompleteJobs(): Promise<void> {
  console.log('[JobResumption] Checking for incomplete jobs...');

  const now = new Date();

  // Find all bookmarks stuck in 'processing' state
  const processingBookmarks = await db.bookmarks
    .where('status')
    .equals('processing')
    .toArray();

  if (processingBookmarks.length === 0) {
    console.log('[JobResumption] No incomplete bookmarks found');
  } else {
    console.log(`[JobResumption] Found ${processingBookmarks.length} bookmarks stuck in 'processing' state`);

    // Reset them to 'downloaded' so they get picked up by the content processing queue
    await Promise.all(
      processingBookmarks.map(bookmark =>
        db.bookmarks.update(bookmark.id, {
          status: 'downloaded',
          updatedAt: now,
        })
      )
    );

    console.log(`[JobResumption] Reset ${processingBookmarks.length} bookmarks to 'downloaded' status`);
  }

  // Find all job items stuck in IN_PROGRESS state
  const inProgressJobItems = await db.jobItems
    .where('status')
    .equals(JobItemStatus.IN_PROGRESS)
    .toArray();

  if (inProgressJobItems.length === 0) {
    console.log('[JobResumption] No incomplete job items found');
  } else {
    console.log(`[JobResumption] Found ${inProgressJobItems.length} job items stuck in IN_PROGRESS state`);

    // Reset them to PENDING so they get picked up again
    await Promise.all(
      inProgressJobItems.map(item =>
        db.jobItems.update(item.id, {
          status: JobItemStatus.PENDING,
          updatedAt: now,
        })
      )
    );

    console.log(`[JobResumption] Reset ${inProgressJobItems.length} job items to PENDING status`);
  }

  console.log('[JobResumption] Job resumption complete');
}
