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
  let jobs = await db.jobs.orderBy('createdAt').reverse().toArray();

  if (options?.type !== undefined) {
    jobs = jobs.filter(job => job.type === options.type);
  }

  if (options?.status !== undefined) {
    jobs = jobs.filter(job => job.status === options.status);
  }

  if (options?.parentJobId !== undefined) {
    jobs = jobs.filter(job => job.parentJobId === options.parentJobId);
  }

  return jobs.slice(0, options?.limit ?? 100);
}

export async function getJobsByParent(parentJobId: string): Promise<Job[]> {
  return db.jobs.where('parentJobId').equals(parentJobId).toArray();
}

export async function cleanupOldJobs(daysOld = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const oldJobs = await db.jobs
    .filter(job => job.createdAt < cutoffDate)
    .toArray();

  const jobIds = oldJobs.map(job => job.id);
  await db.jobs.bulkDelete(jobIds);

  return jobIds.length;
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

// JobItem management functions

export async function createJobItem(params: {
  jobId: string;
  bookmarkId: string;
  status?: JobItemStatus;
}): Promise<JobItem> {
  const now = new Date();
  const jobItem: JobItem = {
    id: crypto.randomUUID(),
    jobId: params.jobId,
    bookmarkId: params.bookmarkId,
    status: params.status ?? JobItemStatus.PENDING,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.jobItems.add(jobItem);
  return jobItem;
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

export async function getJobStats(jobId: string): Promise<{
  total: number;
  pending: number;
  inProgress: number;
  complete: number;
  error: number;
}> {
  const items = await getJobItems(jobId);
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
