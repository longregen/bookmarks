import { db, JobStatus } from '../db/schema';
import { updateJob, completeJob, failJob, getJobsByParent, incrementParentJobProgress } from '../lib/jobs';
import { browserFetch } from '../lib/browser-fetch';
import { extractTitleFromHtml } from '../lib/bulk-import';
import { startProcessingQueue } from './queue';
import { config } from '../lib/config-registry';
import { getErrorMessage } from '../lib/errors';

export async function processBulkFetch(parentJobId: string, isResumption = false): Promise<void> {
  try {
    const parentJob = await db.jobs.get(parentJobId);
    if (!parentJob) return;

    const pendingJobIds = (await getJobsByParent(parentJobId))
      .filter(job => job.status === JobStatus.PENDING)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map(job => job.id);

    for (let i = 0; i < pendingJobIds.length; i += config.FETCH_CONCURRENCY) {
      const batch = pendingJobIds.slice(i, i + config.FETCH_CONCURRENCY);
      await Promise.allSettled(batch.map(jobId => processSingleFetch(jobId, parentJobId)));
    }

    const finalParentJob = await db.jobs.get(parentJobId);
    if (finalParentJob) {
      await completeJob(parentJobId, {
        ...finalParentJob.metadata,
        ...(isResumption && { resumedAt: new Date().toISOString() }),
      });
    }

    void startProcessingQueue();
  } catch (error) {
    await failJob(parentJobId, getErrorMessage(error));
  }
}

async function processSingleFetch(jobId: string, parentJobId: string): Promise<void> {
  try {
    const job = await db.jobs.get(jobId);
    if (!job) return;

    const { url } = job.metadata;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (url === undefined || url === null || url === '') {
      await failJob(jobId, 'Missing URL in job metadata');
      return;
    }

    await updateJob(jobId, { status: JobStatus.IN_PROGRESS });

    const startTime = Date.now();
    const html = await browserFetch(url, config.FETCH_TIMEOUT_MS);
    const fetchTimeMs = Date.now() - startTime;

    const existing = await db.bookmarks.where('url').equals(url).first();
    let bookmarkId: string;

    if (existing) {
      await db.bookmarks.update(existing.id, {
        html,
        title: extractTitleFromHtml(html) || existing.title,
        status: 'pending',
        updatedAt: new Date(),
      });
      bookmarkId = existing.id;
    } else {
      bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url,
        title: extractTitleFromHtml(html) || url,
        html,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await completeJob(jobId, { url, fetchTimeMs, htmlSize: html.length, bookmarkId });
    await db.jobs.update(jobId, { bookmarkId });
    await incrementParentJobProgress(parentJobId, true);
  } catch (error) {
    await failJob(jobId, getErrorMessage(error));
    await incrementParentJobProgress(parentJobId, false);
  }
}
