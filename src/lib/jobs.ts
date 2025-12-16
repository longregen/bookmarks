import { db, Job, JobType, JobStatus } from '../db/schema';
import { broadcastEvent } from './events';

export type { Job };

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
  await broadcastEvent('JOB_UPDATED', { jobId, updates: updatedJob });
}

/**
 * Generic internal helper to set a final status for a job
 * Reduces duplication across completeJob, failJob, and cancelJob
 */
async function setJobFinalStatus(
  jobId: string,
  status: JobStatus,
  extraMetadata?: Partial<Job['metadata']>
): Promise<void> {
  const job = await db.jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  await db.jobs.update(jobId, {
    status,
    progress: status === JobStatus.COMPLETED ? 100 : job.progress,
    metadata: extraMetadata ? { ...job.metadata, ...extraMetadata } : job.metadata,
    updatedAt: new Date(),
    completedAt: new Date(),
  });
  await broadcastEvent('JOB_UPDATED', { jobId, status });
}

export async function completeJob(
  jobId: string,
  metadata?: Partial<Job['metadata']>
): Promise<void> {
  await setJobFinalStatus(jobId, JobStatus.COMPLETED, metadata);
}

export async function failJob(
  jobId: string,
  error: Error | string
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  await setJobFinalStatus(jobId, JobStatus.FAILED, {
    errorMessage,
    errorStack,
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await setJobFinalStatus(jobId, JobStatus.CANCELLED);
}

export async function getJobsByBookmark(bookmarkId: string): Promise<Job[]> {
  return await db.jobs
    .where('bookmarkId')
    .equals(bookmarkId)
    .reverse()
    .sortBy('createdAt');
}

export async function getJobsByParent(parentJobId: string): Promise<Job[]> {
  return await db.jobs
    .where('parentJobId')
    .equals(parentJobId)
    .sortBy('createdAt');
}

export async function getActiveJobs(): Promise<Job[]> {
  return await db.jobs
    .where('status')
    .equals(JobStatus.IN_PROGRESS)
    .sortBy('createdAt');
}

export async function getRecentJobs(options?: {
  limit?: number;
  type?: JobType;
  status?: JobStatus;
  parentJobId?: string;
}): Promise<Job[]> {
  let query = db.jobs.orderBy('createdAt').reverse();

  // Get all jobs first (we'll filter and limit after)
  let jobs = await query.toArray();

  // Apply filters before limiting
  if (options?.type) {
    jobs = jobs.filter(job => job.type === options.type);
  }

  if (options?.status) {
    jobs = jobs.filter(job => job.status === options.status);
  }

  if (options?.parentJobId !== undefined) {
    jobs = jobs.filter(job => job.parentJobId === options.parentJobId);
  }

  // Apply limit after filtering
  return jobs.slice(0, options?.limit || 100);
}

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

export async function findInterruptedJobs(): Promise<{
  bulkImportJobs: Job[];
  pendingFetchJobs: Job[];
  inProgressFetchJobs: Job[];
}> {
  const bulkImportJobs = await db.jobs
    .where('type')
    .equals(JobType.BULK_URL_IMPORT)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  const pendingFetchJobs = await db.jobs
    .where('type')
    .equals(JobType.URL_FETCH)
    .and(job => job.status === JobStatus.PENDING)
    .sortBy('updatedAt');

  const inProgressFetchJobs = await db.jobs
    .where('type')
    .equals(JobType.URL_FETCH)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  return { bulkImportJobs, pendingFetchJobs, inProgressFetchJobs };
}

export async function resetInterruptedJobs(): Promise<{
  bulkImportsReset: number;
  fetchJobsReset: number;
}> {
  const { bulkImportJobs, inProgressFetchJobs } = await findInterruptedJobs();

  let bulkImportsReset = 0;
  let fetchJobsReset = 0;

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
  }

  for (const job of bulkImportJobs) {
    bulkImportsReset++;
  }

  return { bulkImportsReset, fetchJobsReset };
}

export async function getBulkImportsToResume(): Promise<Job[]> {
  const inProgressBulkImports = await db.jobs
    .where('type')
    .equals(JobType.BULK_URL_IMPORT)
    .and(job => job.status === JobStatus.IN_PROGRESS)
    .sortBy('updatedAt');

  const jobsToResume: Job[] = [];

  for (const parentJob of inProgressBulkImports) {
    const incompleteChildren = await db.jobs
      .where('parentJobId')
      .equals(parentJob.id)
      .and(job => job.status === JobStatus.PENDING || job.status === JobStatus.IN_PROGRESS)
      .count();

    if (incompleteChildren > 0) {
      jobsToResume.push(parentJob);
    } else {
      const childJobs = await getJobsByParent(parentJob.id);
      const successCount = childJobs.filter(j => j.status === JobStatus.COMPLETED).length;
      const failureCount = childJobs.filter(j => j.status === JobStatus.FAILED).length;
      await completeJob(parentJob.id, {
        ...parentJob.metadata,
        successCount,
        failureCount,
        resumedAndCompleted: true,
      });
    }
  }

  return jobsToResume;
}

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
  await broadcastEvent('JOB_UPDATED', { jobId: parentJobId });
}
