/**
 * Job Resumption Module
 *
 * Handles recovery of interrupted jobs when the service worker restarts.
 * This is critical for batch imports that may take longer than the service worker's lifetime.
 */

import { resetInterruptedJobs, getBulkImportsToResume, failJob, updateJob } from '../lib/jobs';
import { db } from '../db/schema';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';
import { shouldRetry, categorizeError, calculateBackoff, DEFAULT_RETRY_CONFIG, ErrorCategory, sleep } from '../lib/retry';

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

    // Resume each bulk import with retry logic
    for (const parentJob of bulkImportsToResume) {
      console.log(`Resuming bulk import: ${parentJob.id} (${parentJob.metadata.successCount || 0}/${parentJob.metadata.totalUrls} complete)`);

      // Process in background with proper error handling and retry logic
      resumeBulkImportWithRetry(parentJob.id).catch(error => {
        console.error(`Failed to resume bulk import ${parentJob.id} after all retries:`, error);
      });
    }
  }

  return {
    resumedBulkImports: bulkImportsToResume.length,
    resetFetchJobs: fetchJobsReset,
  };
}

/**
 * Resume a bulk import job with retry logic
 * Implements exponential backoff and proper error handling
 * @param parentJobId Bulk import job ID to resume
 */
async function resumeBulkImportWithRetry(parentJobId: string): Promise<void> {
  // Get the current job from database
  const parentJob = await db.jobs.get(parentJobId);

  if (!parentJob) {
    console.error(`Bulk import job ${parentJobId} not found`);
    return;
  }

  const currentRetryCount = parentJob.metadata.retryCount || 0;

  try {
    // Update job metadata with retry info
    if (currentRetryCount > 0) {
      await updateJob(parentJobId, {
        metadata: {
          ...parentJob.metadata,
          retryCount: currentRetryCount,
        },
      });
    }

    // Attempt to process the bulk fetch
    await processBulkFetch(parentJobId, true);
  } catch (error) {
    console.error(`Error resuming bulk import ${parentJobId} (attempt ${currentRetryCount + 1}):`, error);

    const errorCategory = categorizeError(error);

    // Check if we should retry
    if (shouldRetry(error, currentRetryCount, DEFAULT_RETRY_CONFIG)) {
      const newRetryCount = currentRetryCount + 1;
      const backoffMs = calculateBackoff(currentRetryCount, DEFAULT_RETRY_CONFIG);

      console.log(
        `Scheduling retry ${newRetryCount}/${DEFAULT_RETRY_CONFIG.maxRetries} for bulk import ${parentJobId}`,
        `after ${backoffMs}ms backoff. Error category: ${errorCategory}`
      );

      // Update job with retry count
      await updateJob(parentJobId, {
        metadata: {
          ...parentJob.metadata,
          retryCount: newRetryCount,
          lastError: error instanceof Error ? error.message : String(error),
          lastErrorCategory: errorCategory,
        },
      });

      // Wait for backoff period
      await sleep(backoffMs);

      // Retry
      return resumeBulkImportWithRetry(parentJobId);
    } else {
      // Max retries exceeded or fatal error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (currentRetryCount >= DEFAULT_RETRY_CONFIG.maxRetries) {
        console.error(
          `Max retries (${DEFAULT_RETRY_CONFIG.maxRetries}) exceeded for bulk import ${parentJobId}. Marking as failed.`
        );
      } else {
        console.error(
          `Fatal error (${errorCategory}) for bulk import ${parentJobId}. Not retrying.`
        );
      }

      // Mark job as failed with error details
      await failJob(parentJobId, error instanceof Error ? error : String(error));

      // Update job metadata with additional context
      await updateJob(parentJobId, {
        metadata: {
          ...parentJob.metadata,
          retryCount: currentRetryCount,
          errorCategory,
          finalError: errorMessage,
          finalErrorStack: errorStack,
        },
      });

      throw error;
    }
  }
}
