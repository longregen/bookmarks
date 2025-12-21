import { db, JobStatus } from '../db/schema';
import { getErrorMessage } from './errors';

export interface StorageEstimate {
  usage: number;
  quota: number;
  percentUsed: number;
  available: number;
}

export interface CleanupResult {
  searchHistoryDeleted: number;
  jobsDeleted: number;
  jobItemsDeleted: number;
  totalSpaceFreed: number;
}

const QUOTA_WARNING_THRESHOLD = 0.8; // 80%
const CLEANUP_JOBS_OLDER_THAN_DAYS = 30;

/**
 * Estimates current storage usage using the Storage API.
 * Returns undefined if the API is not available.
 */
export async function estimateStorageUsage(): Promise<StorageEstimate | undefined> {
  // Check if navigator.storage.estimate is available
  if (typeof navigator === 'undefined') {
    console.warn('[QuotaMonitor] Navigator not available');
    return undefined;
  }

  const storage = navigator.storage;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
  if (!storage || typeof storage.estimate !== 'function') {
    console.warn('[QuotaMonitor] Storage API not available');
    return undefined;
  }

  try {
    const estimate = await storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;

    if (quota === 0) {
      console.warn('[QuotaMonitor] Storage quota is 0, may not be supported');
      return undefined;
    }

    const percentUsed = usage / quota;
    const available = quota - usage;

    return {
      usage,
      quota,
      percentUsed,
      available,
    };
  } catch (error) {
    console.error('[QuotaMonitor] Failed to estimate storage:', getErrorMessage(error));
    return undefined;
  }
}

/**
 * Checks if storage quota is approaching the limit (>80% by default).
 */
export async function isQuotaApproachingLimit(threshold = QUOTA_WARNING_THRESHOLD): Promise<boolean> {
  const estimate = await estimateStorageUsage();
  if (!estimate) {
    return false;
  }

  return estimate.percentUsed >= threshold;
}

/**
 * Cleans up old data to free storage space:
 * - Deletes search history beyond the configured limit
 * - Deletes completed/failed/cancelled jobs older than 30 days and their job items
 */
export async function cleanupOldData(): Promise<CleanupResult> {
  console.log('[QuotaMonitor] Starting cleanup of old data');

  const result: CleanupResult = {
    searchHistoryDeleted: 0,
    jobsDeleted: 0,
    jobItemsDeleted: 0,
    totalSpaceFreed: 0,
  };

  const beforeEstimate = await estimateStorageUsage();

  // Clean up search history (keep only the most recent entries based on config)
  try {
    const allHistory = await db.searchHistory.orderBy('createdAt').toArray();
    const limit = 50; // Use a conservative limit during cleanup

    if (allHistory.length > limit) {
      const toDelete = allHistory.slice(0, allHistory.length - limit);
      await Promise.all(toDelete.map(h => db.searchHistory.delete(h.id)));
      result.searchHistoryDeleted = toDelete.length;
      console.log(`[QuotaMonitor] Deleted ${toDelete.length} old search history entries`);
    }
  } catch (error) {
    console.error('[QuotaMonitor] Failed to cleanup search history:', getErrorMessage(error));
  }

  // Clean up old completed/failed/cancelled jobs
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_JOBS_OLDER_THAN_DAYS);

    const oldJobs = await db.jobs
      .where('createdAt')
      .below(cutoffDate)
      .filter(job =>
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED ||
        job.status === JobStatus.CANCELLED
      )
      .toArray();

    if (oldJobs.length > 0) {
      const jobIds = oldJobs.map(j => j.id);

      // Delete associated job items first
      for (const jobId of jobIds) {
        const deletedItems = await db.jobItems.where('jobId').equals(jobId).delete();
        result.jobItemsDeleted += deletedItems;
      }

      // Delete the jobs
      await Promise.all(jobIds.map(id => db.jobs.delete(id)));
      result.jobsDeleted = oldJobs.length;

      console.log(
        `[QuotaMonitor] Deleted ${result.jobsDeleted} old jobs and ${result.jobItemsDeleted} job items`
      );
    }
  } catch (error) {
    console.error('[QuotaMonitor] Failed to cleanup old jobs:', getErrorMessage(error));
  }

  // Calculate space freed
  const afterEstimate = await estimateStorageUsage();
  if (beforeEstimate && afterEstimate) {
    result.totalSpaceFreed = beforeEstimate.usage - afterEstimate.usage;
    console.log(
      `[QuotaMonitor] Cleanup completed. Freed ${formatBytes(result.totalSpaceFreed)}`
    );
  }

  return result;
}

/**
 * Wraps a database operation with QuotaExceededError handling.
 * If quota is exceeded, attempts cleanup and retries once.
 */
export async function withQuotaHandling<T>(
  operation: () => Promise<T>,
  operationName = 'Database operation'
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(`[QuotaMonitor] QuotaExceededError during ${operationName}, attempting cleanup`);

      try {
        const cleanupResult = await cleanupOldData();
        console.log(
          `[QuotaMonitor] Cleanup freed space, retrying ${operationName}`,
          cleanupResult
        );

        // Retry the operation once
        return await operation();
      } catch (retryError) {
        if (isQuotaExceededError(retryError)) {
          console.error(`[QuotaMonitor] Still quota exceeded after cleanup for ${operationName}`);
          throw new Error(
            'Storage quota exceeded. Please delete some bookmarks or clear your browser data.'
          );
        }
        throw retryError;
      }
    }
    throw error;
  }
}

/**
 * Checks if an error is a QuotaExceededError.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError';
  }
  if (error instanceof Error) {
    return (
      error.name === 'QuotaExceededError' ||
      error.message.toLowerCase().includes('quota')
    );
  }
  return false;
}

/**
 * Formats bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(-bytes)}`;

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Formats storage estimate as a human-readable string.
 */
export function formatStorageEstimate(estimate: StorageEstimate): string {
  const percentStr = (estimate.percentUsed * 100).toFixed(1);
  return `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)} (${percentStr}%)`;
}

/**
 * Logs current storage status to console.
 */
export async function logStorageStatus(): Promise<void> {
  const estimate = await estimateStorageUsage();
  if (!estimate) {
    console.log('[QuotaMonitor] Storage information not available');
    return;
  }

  console.log('[QuotaMonitor] Storage status:', {
    usage: formatBytes(estimate.usage),
    quota: formatBytes(estimate.quota),
    available: formatBytes(estimate.available),
    percentUsed: `${(estimate.percentUsed * 100).toFixed(1)}%`,
  });

  if (estimate.percentUsed >= QUOTA_WARNING_THRESHOLD) {
    console.warn('[QuotaMonitor] WARNING: Storage usage is approaching quota limit!');
  }
}
