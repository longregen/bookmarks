import { db, type Job, JobType, JobStatus } from '../db/schema';

export { type Job, JobType, JobStatus };

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
  await db.bookmarks.delete(bookmarkId);
}
