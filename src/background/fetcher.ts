/**
 * Background fetcher for bulk URL imports
 * Handles fetching URLs in parallel batches with proper job tracking
 */

import { db, JobType, JobStatus } from '../db/schema';
import { updateJob, completeJob, failJob, getJobsByParent, incrementParentJobProgress } from '../lib/jobs';
import { browserFetch } from '../lib/browser-fetch';
import { extractTitleFromHtml } from '../lib/bulk-import';
import { startProcessingQueue } from './queue';
export { ensureOffscreenDocument } from '../lib/offscreen';

const CONCURRENCY = 5; // Process 5 URLs concurrently
const TIMEOUT_MS = 30000; // 30 second timeout per URL

/**
 * Process a bulk import job by fetching all child URL jobs
 * Supports resumption - only processes PENDING jobs (skips COMPLETED/FAILED)
 * @param parentJobId Parent bulk import job ID
 * @param isResumption Whether this is resuming an interrupted job
 */
export async function processBulkFetch(parentJobId: string, isResumption: boolean = false): Promise<void> {
  try {
    // Get parent job
    const parentJob = await db.jobs.get(parentJobId);
    if (!parentJob) {
      console.error('Parent job not found:', parentJobId);
      return;
    }

    // Get all child jobs
    const allChildJobs = await getJobsByParent(parentJobId);

    // Only process PENDING jobs (allows resumption of interrupted bulk imports)
    // Sort by updatedAt ascending so oldest/least recently tried jobs go first (round-robin)
    const pendingJobs = allChildJobs
      .filter(job => job.status === JobStatus.PENDING)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    const pendingJobIds = pendingJobs.map(job => job.id);

    if (isResumption) {
      const completedCount = allChildJobs.filter(j => j.status === JobStatus.COMPLETED).length;
      const failedCount = allChildJobs.filter(j => j.status === JobStatus.FAILED).length;
      console.log(`Resuming bulk fetch: ${pendingJobIds.length} pending, ${completedCount} completed, ${failedCount} failed`);
    } else {
      console.log(`Starting bulk fetch for ${pendingJobIds.length} URLs`);
    }

    if (pendingJobIds.length === 0) {
      console.log('No pending jobs to process');
    } else {
      // Process in batches
      for (let i = 0; i < pendingJobIds.length; i += CONCURRENCY) {
        const batch = pendingJobIds.slice(i, i + CONCURRENCY);

        console.log(`Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(pendingJobIds.length / CONCURRENCY)}`);

        await Promise.allSettled(
          batch.map(jobId => processSingleFetch(jobId, parentJobId))
        );
      }
    }

    // Complete parent job
    const finalParentJob = await db.jobs.get(parentJobId);
    if (finalParentJob) {
      await completeJob(parentJobId, {
        ...finalParentJob.metadata,
        resumedAt: isResumption ? new Date().toISOString() : undefined,
      });
    }

    console.log('Bulk fetch completed');

    // Trigger queue processing for newly imported bookmarks
    startProcessingQueue();
  } catch (error) {
    console.error('Error processing bulk fetch:', error);
    await failJob(parentJobId, error instanceof Error ? error : String(error));
  }
}

/**
 * Process a single URL fetch job
 * @param jobId Job ID for the URL fetch
 * @param parentJobId Parent job ID for updating progress
 */
async function processSingleFetch(jobId: string, parentJobId: string): Promise<void> {
  try {
    const job = await db.jobs.get(jobId);
    if (!job) {
      console.error('Job not found:', jobId);
      return;
    }

    const { url } = job.metadata;
    if (!url) {
      console.error('Job missing URL:', jobId);
      await failJob(jobId, 'Missing URL in job metadata');
      return;
    }

    console.log(`Fetching: ${url}`);

    // Update job status to in-progress
    await updateJob(jobId, {
      status: JobStatus.IN_PROGRESS,
    });

    // Fetch with timeout
    const startTime = Date.now();
    const html = await browserFetch(url, TIMEOUT_MS);
    const fetchTimeMs = Date.now() - startTime;

    console.log(`Fetched ${url} in ${fetchTimeMs}ms (${(html.length / 1024).toFixed(2)} KB)`);

    // Check if bookmark already exists
    const existing = await db.bookmarks.where('url').equals(url).first();

    let bookmarkId: string;

    if (existing) {
      // Update existing bookmark with new HTML
      await db.bookmarks.update(existing.id, {
        html,
        title: extractTitleFromHtml(html) || existing.title,
        status: 'pending',
        updatedAt: new Date(),
      });
      bookmarkId = existing.id;
      console.log(`Updated existing bookmark: ${url}`);
    } else {
      // Create new bookmark
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
      console.log(`Created new bookmark: ${url}`);
    }

    // Update fetch job as completed
    await completeJob(jobId, {
      url,
      fetchTimeMs,
      htmlSize: html.length,
      bookmarkId,
    });

    // Link job to bookmark
    await db.jobs.update(jobId, { bookmarkId });

    // Update parent job success count and progress
    await incrementParentJobProgress(parentJobId, true);

  } catch (error) {
    console.error(`Error fetching URL:`, error);

    // Update fetch job as failed
    await failJob(jobId, error instanceof Error ? error : String(error));

    // Update parent job failure count and progress
    await incrementParentJobProgress(parentJobId, false);
  }
}
