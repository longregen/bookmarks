import { db, type Job, type JobItem, JobType, JobStatus, JobItemStatus } from '../db/schema';

export { type Job, type JobItem, JobType, JobStatus, JobItemStatus };

export async function createJob(params: {
  type: JobType;
  status: JobStatus;
  parentJobId?: string;
  metadata?: Job['metadata'];
}): Promise<Job> {
  const job: Job = {
    id: crypto.randomUUID(),
    type: params.type,
    status: params.status,
    parentJobId: params.parentJobId,
    metadata: params.metadata ?? {},
    createdAt: new Date(),
  };

  await db.jobs.add(job);
  return job;
}

export async function getRecentJobs(options?: {
  limit?: number;
  type?: JobType;
  status?: JobStatus;
  parentJobId?: string;
}): Promise<Job[]> {
  const limit = options?.limit ?? 100;

  // Use indexed queries when possible for better performance
  if (options?.parentJobId !== undefined) {
    let jobs = await db.jobs.where('parentJobId').equals(options.parentJobId).toArray();
    if (options.type !== undefined) {
      jobs = jobs.filter(job => job.type === options.type);
    }
    if (options.status !== undefined) {
      jobs = jobs.filter(job => job.status === options.status);
    }
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return jobs.slice(0, limit);
  }

  if (options?.status !== undefined) {
    let jobs = await db.jobs.where('status').equals(options.status).toArray();
    if (options.type !== undefined) {
      jobs = jobs.filter(job => job.type === options.type);
    }
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return jobs.slice(0, limit);
  }

  if (options?.type !== undefined) {
    const jobs = await db.jobs.where('type').equals(options.type).toArray();
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return jobs.slice(0, limit);
  }

  // No filters - use createdAt index for ordering
  return db.jobs.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function deleteJob(jobId: string): Promise<void> {
  await db.jobs.delete(jobId);
}

export async function deleteBookmarkWithData(bookmarkId: string): Promise<void> {
  await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
  await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
  await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).delete();
  await db.jobItems.where('bookmarkId').equals(bookmarkId).delete();
  await db.bookmarks.delete(bookmarkId);
}

export async function createJobItems(jobId: string, bookmarkIds: string[]): Promise<void> {
  const now = new Date();
  const jobItems: JobItem[] = bookmarkIds.map(bookmarkId => ({
    id: crypto.randomUUID(),
    jobId,
    bookmarkId,
    status: JobItemStatus.PENDING,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  }));

  await db.jobItems.bulkAdd(jobItems);
}

export async function getJobItems(jobId: string): Promise<JobItem[]> {
  return db.jobItems.where('jobId').equals(jobId).toArray();
}

/**
 * Batch load job items for multiple jobs at once to avoid N+1 queries.
 * Returns a Map keyed by jobId.
 */
export async function getBatchJobItems(jobIds: string[]): Promise<Map<string, JobItem[]>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const allItems = await db.jobItems.where('jobId').anyOf(jobIds).toArray();

  const itemsByJob = new Map<string, JobItem[]>();
  for (const jobId of jobIds) {
    itemsByJob.set(jobId, []);
  }
  for (const item of allItems) {
    const items = itemsByJob.get(item.jobId);
    if (items) {
      items.push(item);
    }
  }

  return itemsByJob;
}

export async function getJobItemByBookmark(bookmarkId: string): Promise<JobItem | undefined> {
  return db.jobItems.where('bookmarkId').equals(bookmarkId).first();
}

export async function updateJobItem(
  id: string,
  updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
): Promise<void> {
  await db.jobItems.update(id, {
    ...updates,
    updatedAt: new Date(),
  });
}

export async function updateJobItemByBookmark(
  bookmarkId: string,
  updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
): Promise<void> {
  const jobItem = await getJobItemByBookmark(bookmarkId);
  if (jobItem) {
    await updateJobItem(jobItem.id, updates);
  }
}

export interface JobStats {
  total: number;
  pending: number;
  inProgress: number;
  complete: number;
  error: number;
}

export async function getJobStats(jobId: string): Promise<JobStats> {
  const items = await getJobItems(jobId);
  return computeStatsFromItems(items);
}

/**
 * Batch load stats for multiple jobs at once to avoid N+1 queries.
 * Returns a Map keyed by jobId.
 */
export async function getBatchJobStats(jobIds: string[]): Promise<Map<string, JobStats>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  // Load all job items for all jobs in a single query
  const allItems = await db.jobItems.where('jobId').anyOf(jobIds).toArray();

  // Group items by jobId
  const itemsByJob = new Map<string, JobItem[]>();
  for (const jobId of jobIds) {
    itemsByJob.set(jobId, []);
  }
  for (const item of allItems) {
    const items = itemsByJob.get(item.jobId);
    if (items) {
      items.push(item);
    }
  }

  // Compute stats for each job
  const statsMap = new Map<string, JobStats>();
  for (const [jobId, items] of itemsByJob) {
    statsMap.set(jobId, computeStatsFromItems(items));
  }

  return statsMap;
}

function computeStatsFromItems(items: JobItem[]): JobStats {
  const stats = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status]++;
    return acc;
  }, { pending: 0, in_progress: 0, complete: 0, error: 0 });
  return {
    total: items.length,
    pending: stats.pending,
    inProgress: stats.in_progress,
    complete: stats.complete,
    error: stats.error,
  };
}

export async function updateJobStatus(jobId: string): Promise<void> {
  const stats = await getJobStats(jobId);
  let status: JobStatus;

  if (stats.total === 0) {
    status = JobStatus.COMPLETED;
  } else if (stats.complete === stats.total) {
    status = JobStatus.COMPLETED;
  } else if (stats.error > 0 && stats.pending === 0 && stats.inProgress === 0) {
    // All items are either complete or error, and at least one error
    status = stats.complete > 0 ? JobStatus.COMPLETED : JobStatus.FAILED;
  } else if (stats.inProgress > 0 || stats.pending > 0) {
    status = JobStatus.IN_PROGRESS;
  } else {
    status = JobStatus.COMPLETED;
  }

  await db.jobs.update(jobId, { status });
}

export async function retryFailedJobItems(jobId: string): Promise<number> {
  const items = await db.jobItems
    .where('[jobId+status]')
    .equals([jobId, JobItemStatus.ERROR])
    .toArray();

  const now = new Date();
  const bookmarkIds = items.map(item => item.bookmarkId);

  // Batch update all job items
  await Promise.all(
    items.map(item => db.jobItems.update(item.id, {
      status: JobItemStatus.PENDING,
      retryCount: 0,
      errorMessage: undefined,
      updatedAt: now,
    }))
  );

  // Batch update all bookmarks
  await Promise.all(
    bookmarkIds.map(bookmarkId => db.bookmarks.update(bookmarkId, {
      status: 'fetching',
      errorMessage: undefined,
      retryCount: 0,
      updatedAt: now,
    }))
  );

  // Update job status
  await updateJobStatus(jobId);

  return items.length;
}

export async function retryBookmark(bookmarkId: string): Promise<void> {
  const now = new Date();

  // Reset the bookmark
  await db.bookmarks.update(bookmarkId, {
    status: 'fetching',
    errorMessage: undefined,
    retryCount: 0,
    updatedAt: now,
  });

  // Reset the job item if exists
  const jobItem = await getJobItemByBookmark(bookmarkId);
  if (jobItem) {
    await db.jobItems.update(jobItem.id, {
      status: JobItemStatus.PENDING,
      retryCount: 0,
      errorMessage: undefined,
      updatedAt: now,
    });
    await updateJobStatus(jobItem.jobId);
  }
}
