/**
 * Job Resumption Module
 *
 * Handles recovery of interrupted jobs when the service worker restarts.
 * This is critical for batch imports that may take longer than the service worker's lifetime.
 */

import { resetInterruptedJobs, getBulkImportsToResume } from '../lib/jobs';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';

/**
 * Resume all interrupted jobs
 * Should be called on service worker startup
 */
export async function resumeInterruptedJobs(): Promise<{
  resumedBulkImports: number;
  resetFetchJobs: number;
}> {
  console.log('Checking for interrupted jobs...');

  // First, reset any IN_PROGRESS fetch jobs back to PENDING
  const { bulkImportsReset, fetchJobsReset } = await resetInterruptedJobs();

  if (bulkImportsReset === 0 && fetchJobsReset === 0) {
    console.log('No interrupted jobs found');
    return { resumedBulkImports: 0, resetFetchJobs: 0 };
  }

  console.log(`Found ${bulkImportsReset} interrupted bulk imports, ${fetchJobsReset} fetch jobs reset`);

  // Get bulk imports that need resumption
  const bulkImportsToResume = await getBulkImportsToResume();

  if (bulkImportsToResume.length > 0) {
    console.log(`Resuming ${bulkImportsToResume.length} bulk import(s)...`);

    // Ensure offscreen document exists (Chrome only)
    if (__IS_CHROME__) {
      await ensureOffscreenDocument();
    }

    // Resume each bulk import
    for (const parentJob of bulkImportsToResume) {
      console.log(`Resuming bulk import: ${parentJob.id} (${parentJob.metadata.successCount || 0}/${parentJob.metadata.totalUrls} complete)`);

      // Process in background - don't await to allow parallel resumption
      processBulkFetch(parentJob.id, true).catch(error => {
        console.error(`Error resuming bulk import ${parentJob.id}:`, error);
      });
    }
  }

  return {
    resumedBulkImports: bulkImportsToResume.length,
    resetFetchJobs: fetchJobsReset,
  };
}
