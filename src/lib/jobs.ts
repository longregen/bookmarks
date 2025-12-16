import { db, Job, JobType, JobStatus } from '../db/schema';
import { broadcastJobUpdate } from './events';
import { JOB_COMPLETE_PROGRESS, DEFAULT_JOBS_LIMIT, DEFAULT_JOB_RETENTION_DAYS } from './constants';

// Re-export Job type for consumers
export type { Job };

/**
 * Create a new job in the database
 * @param params Job creation parameters
 * @returns The created job with generated ID
 */
export async function createJob(params: {
  type: JobType;
  status?: JobStatus;
  parentJobId?: string;
  bookmarkId?: string;
  progress?: number;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
  metadata?: Job['metadata'];
}): Promise<Job> {
  const now = new Date();
  const job: Job = {
    id: crypto.randomUUID(),
    type: params.type,
    status: params.status || JobStatus.PENDING,
    parentJobId: params.parentJobId,
    bookmarkId: params.bookmarkId,
    progress: params.progress || 0,
    currentStep: params.currentStep,
    totalSteps: params.totalSteps,
    completedSteps: params.completedSteps,
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  await db.jobs.add(job);
  return job;
}

/**
 * Update an existing job's progress and/or status
 * @param jobId Job ID to update
 * @param updates Fields to update
 */
export async function updateJob(
  jobId: string,
  updates: {
    status?: JobStatus;
    progress?: number;
    currentStep?: string;
    completedSteps?: number;
    metadata?: Partial<Job['metadata']>;
  }
): Promise<void> {
  const job = await db.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const updatedJob: Partial<Job> = {
    updatedAt: new Date(),
  };

  if (updates.status !== undefined) {
    updatedJob.status = updates.status;
    if (updates.status === JobStatus.COMPLETED || updates.status === JobStatus.FAILED || updates.status === JobStatus.CANCELLED) {
      updatedJob.completedAt = new Date();
    }
  }

  if (updates.progress !== undefined) {
    updatedJob.progress = updates.progress;
  }

  if (updates.currentStep !== undefined) {
    updatedJob.currentStep = updates.currentStep;
  }

  if (updates.completedSteps !== undefined) {
    updatedJob.completedSteps = updates.completedSteps;
  }

  if (updates.metadata !== undefined) {
    updatedJob.metadata = {
      ...job.metadata,
      ...updates.metadata,
    };
  }

  await db.jobs.update(jobId, updatedJob);

  // Broadcast job update
  const updatedJobData = await db.jobs.get(jobId);
  if (updatedJobData) {
    await broadcastJobUpdate({
      jobId: updatedJobData.id,
      status: updatedJobData.status,
      progress: updatedJobData.progress,
      metadata: updatedJobData.metadata,
    }).catch(err => {
      console.error('Failed to broadcast job update:', err);
    });
  }
}

/**
 * Mark a job as completed with optional metadata
 * @param jobId Job ID to complete
 * @param metadata Additional metadata to store
 */
export async function completeJob(
  jobId: string,
  metadata?: Partial<Job['metadata']>
): Promise<void> {
  const job = await db.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  await db.jobs.update(jobId, {
    status: JobStatus.COMPLETED,
    progress: JOB_COMPLETE_PROGRESS,
    metadata: metadata ? { ...job.metadata, ...metadata } : job.metadata,
    updatedAt: new Date(),
    completedAt: new Date(),
  });

  // Broadcast job completion
  const updatedJobData = await db.jobs.get(jobId);
  if (updatedJobData) {
    await broadcastJobUpdate({
      jobId: updatedJobData.id,
      status: updatedJobData.status,
      progress: updatedJobData.progress,
      metadata: updatedJobData.metadata,
    }).catch(err => {
      console.error('Failed to broadcast job completion:', err);
    });
  }
}

/**
 * Mark a job as failed with error details
 * @param jobId Job ID to fail
 * @param error Error object or message
 */
export async function failJob(
  jobId: string,
  error: Error | string
): Promise<void> {
  const job = await db.jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  await db.jobs.update(jobId, {
    status: JobStatus.FAILED,
    metadata: {
      ...job.metadata,
      errorMessage,
      errorStack,
    },
    updatedAt: new Date(),
    completedAt: new Date(),
  });

  // Broadcast job failure
  const updatedJobData = await db.jobs.get(jobId);
  if (updatedJobData) {
    await broadcastJobUpdate({
      jobId: updatedJobData.id,
      status: updatedJobData.status,
      progress: updatedJobData.progress,
      metadata: updatedJobData.metadata,
    }).catch(err => {
      console.error('Failed to broadcast job failure:', err);
    });
  }
}

/**
 * Cancel a job
 * @param jobId Job ID to cancel
 */
export async function cancelJob(jobId: string): Promise<void> {
  await db.jobs.update(jobId, {
    status: JobStatus.CANCELLED,
    updatedAt: new Date(),
    completedAt: new Date(),
  });
}

/**
 * Get all jobs associated with a bookmark
 * @param bookmarkId Bookmark ID
 * @returns Array of jobs ordered by creation date (newest first)
 */
export async function getJobsByBookmark(bookmarkId: string): Promise<Job[]> {
  return await db.jobs
    .where('bookmarkId')
    .equals(bookmarkId)
    .reverse()
    .sortBy('createdAt');
}

/**
 * Get all child jobs of a parent job
 * @param parentJobId Parent job ID
 * @returns Array of child jobs ordered by creation date
 */
export async function getJobsByParent(parentJobId: string): Promise<Job[]> {
  return await db.jobs
    .where('parentJobId')
    .equals(parentJobId)
    .sortBy('createdAt');
}

/**
 * Get all active (in-progress) jobs
 * @returns Array of in-progress jobs
 */
export async function getActiveJobs(): Promise<Job[]> {
  return await db.jobs
    .where('status')
    .equals(JobStatus.IN_PROGRESS)
    .sortBy('createdAt');
}

/**
 * Get recent jobs with optional filtering
 * @param options Filter options
 * @returns Array of jobs matching criteria
 */
export async function getRecentJobs(options?: {
  limit?: number;
  type?: JobType;
  status?: JobStatus;
  parentJobId?: string;
}): Promise<Job[]> {
  let query = db.jobs.orderBy('createdAt').reverse();

  // Only apply database-level limit if no filters are set
  // Otherwise we need to filter first, then limit
  const hasFilters = options?.type || options?.status || options?.parentJobId !== undefined;
  if (options?.limit && !hasFilters) {
    query = query.limit(options.limit);
  }

  let jobs = await query.toArray();

  // Apply additional filters
  if (options?.type) {
    jobs = jobs.filter(job => job.type === options.type);
  }

  if (options?.status) {
    jobs = jobs.filter(job => job.status === options.status);
  }

  if (options?.parentJobId !== undefined) {
    jobs = jobs.filter(job => job.parentJobId === options.parentJobId);
  }

  return jobs.slice(0, options?.limit || DEFAULT_JOBS_LIMIT);
}

/**
 * Delete completed jobs older than the specified number of days
 * @param daysOld Number of days (default: 30)
 * @returns Number of jobs deleted
 */
export async function cleanupOldJobs(daysOld: number = DEFAULT_JOB_RETENTION_DAYS): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const oldJobs = await db.jobs
    .where('status')
    .equals(JobStatus.COMPLETED)
    .and(job => job.createdAt < cutoffDate)
    .toArray();

  const jobIds = oldJobs.map(job => job.id);
  await db.jobs.bulkDelete(jobIds);

  return jobIds.length;
}

/**
 * Find all jobs that were interrupted (stuck in IN_PROGRESS or PENDING with no active processor)
 * This is used to detect jobs that need resumption after a service worker restart
 * All results are sorted by updatedAt ascending (oldest first for round-robin processing)
 */
export async function findInterruptedJobs(): Promise<{
  bulkImportJobs: Job[];
  pendingFetchJobs: Job[];
  inProgressFetchJobs: Job[];
}> {
  // Find BULK_URL_IMPORT jobs that are still IN_PROGRESS (parent jobs)
  // Sort by updatedAt ascending so oldest jobs are processed first
  const bulkImportJobs = await db.jobs
    .where('type')
    .equals(JobType.BULK_URL_IMPORT)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  // Find URL_FETCH jobs that are PENDING (never started)
  const pendingFetchJobs = await db.jobs
    .where('type')
    .equals(JobType.URL_FETCH)
    .and(job => job.status === JobStatus.PENDING)
    .sortBy('updatedAt');

  // Find URL_FETCH jobs that were IN_PROGRESS (started but interrupted)
  const inProgressFetchJobs = await db.jobs
    .where('type')
    .equals(JobType.URL_FETCH)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  return {
    bulkImportJobs,
    pendingFetchJobs,
    inProgressFetchJobs,
  };
}

/**
 * Reset interrupted jobs back to PENDING so they can be resumed
 * @returns Summary of what was reset
 */
export async function resetInterruptedJobs(): Promise<{
  bulkImportsReset: number;
  fetchJobsReset: number;
}> {
  const { bulkImportJobs, inProgressFetchJobs } = await findInterruptedJobs();

  let bulkImportsReset = 0;
  let fetchJobsReset = 0;

  // Reset IN_PROGRESS fetch jobs back to PENDING
  for (const job of inProgressFetchJobs) {
    await db.jobs.update(job.id, {
      status: JobStatus.PENDING,
      updatedAt: new Date(),
      metadata: {
        ...job.metadata,
        retryCount: (job.metadata.retryCount || 0) + 1,
        lastInterruptedAt: new Date().toISOString(),
      },
    });
    fetchJobsReset++;
    console.log(`Reset interrupted fetch job: ${job.id} (URL: ${job.metadata.url})`);
  }

  // For bulk import jobs, we don't reset the parent - we'll resume it
  // Just log what we found
  for (const job of bulkImportJobs) {
    console.log(`Found interrupted bulk import job: ${job.id} (${job.metadata.successCount || 0}/${job.metadata.totalUrls} complete)`);
    bulkImportsReset++;
  }

  return {
    bulkImportsReset,
    fetchJobsReset,
  };
}

/**
 * Get all bulk import parent jobs that need resumption
 * A job needs resumption if it's IN_PROGRESS and has PENDING child jobs
 * Returns jobs sorted by updatedAt ascending (oldest first for round-robin)
 */
export async function getBulkImportsToResume(): Promise<Job[]> {
  // Find BULK_URL_IMPORT jobs that are IN_PROGRESS
  // Sort by updatedAt ascending so oldest/least recently updated jobs go first
  const inProgressBulkImports = await db.jobs
    .where('type')
    .equals(JobType.BULK_URL_IMPORT)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  const jobsToResume: Job[] = [];

  for (const parentJob of inProgressBulkImports) {
    // Check if there are any pending/in_progress child jobs
    const incompleteChildren = await db.jobs
      .where('parentJobId')
      .equals(parentJob.id)
      .and(job => job.status === JobStatus.PENDING || job.status === JobStatus.IN_PROGRESS)
      .count();

    if (incompleteChildren > 0) {
      jobsToResume.push(parentJob);
    } else {
      // All children are complete/failed, mark parent as complete
      const childJobs = await getJobsByParent(parentJob.id);
      const successCount = childJobs.filter(j => j.status === JobStatus.COMPLETED).length;
      const failureCount = childJobs.filter(j => j.status === JobStatus.FAILED).length;

      await completeJob(parentJob.id, {
        ...parentJob.metadata,
        successCount,
        failureCount,
        resumedAndCompleted: true,
      });
      console.log(`Completed orphaned bulk import job: ${parentJob.id}`);
    }
  }

  return jobsToResume;
}

/**
 * Get job statistics
 * @returns Statistics about jobs in the database
 */
export async function getJobStats(): Promise<{
  total: number;
  byStatus: Record<JobStatus, number>;
  byType: Record<JobType, number>;
}> {
  const allJobs = await db.jobs.toArray();

  const byStatus: Record<JobStatus, number> = {
    [JobStatus.PENDING]: 0,
    [JobStatus.IN_PROGRESS]: 0,
    [JobStatus.COMPLETED]: 0,
    [JobStatus.FAILED]: 0,
    [JobStatus.CANCELLED]: 0,
  };

  const byType: Record<JobType, number> = {
    [JobType.MANUAL_ADD]: 0,
    [JobType.MARKDOWN_GENERATION]: 0,
    [JobType.QA_GENERATION]: 0,
    [JobType.FILE_IMPORT]: 0,
    [JobType.BULK_URL_IMPORT]: 0,
    [JobType.URL_FETCH]: 0,
  };

  for (const job of allJobs) {
    byStatus[job.status]++;
    byType[job.type]++;
  }

  return {
    total: allJobs.length,
    byStatus,
    byType,
  };
}

/**
 * Update parent job progress after a child job completes or fails
 * Used for bulk import jobs to track progress across multiple URL fetch jobs
 * @param parentJobId Parent job ID
 * @param success Whether the child job succeeded (true) or failed (false)
 */
export async function incrementParentJobProgress(
  parentJobId: string,
  success: boolean
): Promise<void> {
  await db.jobs.where('id').equals(parentJobId).modify(job => {
    if (success) {
      job.metadata.successCount = (job.metadata.successCount || 0) + 1;
    } else {
      job.metadata.failureCount = (job.metadata.failureCount || 0) + 1;
    }
    const total = job.metadata.totalUrls || 1;
    const completed = (job.metadata.successCount || 0) + (job.metadata.failureCount || 0);
    job.progress = Math.round((completed / total) * 100);
    job.updatedAt = new Date();
  });

  // Broadcast parent job progress update
  const updatedJobData = await db.jobs.get(parentJobId);
  if (updatedJobData) {
    await broadcastJobUpdate({
      jobId: updatedJobData.id,
      status: updatedJobData.status,
      progress: updatedJobData.progress,
      metadata: updatedJobData.metadata,
    }).catch(err => {
      console.error('Failed to broadcast parent job progress:', err);
    });
  }
}
