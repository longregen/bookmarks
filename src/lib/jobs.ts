import { db, Job, JobType, JobStatus } from '../db/schema';

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
    progress: 100,
    metadata: metadata ? { ...job.metadata, ...metadata } : job.metadata,
    updatedAt: new Date(),
    completedAt: new Date(),
  });
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

  if (options?.limit) {
    query = query.limit(options.limit) as any;
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

  return jobs.slice(0, options?.limit || 100);
}

/**
 * Delete completed jobs older than the specified number of days
 * @param daysOld Number of days (default: 30)
 * @returns Number of jobs deleted
 */
export async function cleanupOldJobs(daysOld: number = 30): Promise<number> {
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
