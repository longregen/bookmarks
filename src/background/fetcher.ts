/**
 * Background fetcher for bulk URL imports
 * Handles fetching URLs in parallel batches with proper job tracking
 */

import { db, JobType, JobStatus } from '../db/schema';
import { updateJob, completeJob, failJob, getJobsByParent } from '../lib/jobs';
import { browserFetch } from '../lib/browser-fetch';
import { extractTitleFromHtml } from '../lib/bulk-import';
import { startProcessingQueue } from './queue';

const CONCURRENCY = 5; // Process 5 URLs concurrently
const TIMEOUT_MS = 30000; // 30 second timeout per URL

/**
 * Process a bulk import job by fetching all child URL jobs
 * @param parentJobId Parent bulk import job ID
 */
export async function processBulkFetch(parentJobId: string): Promise<void> {
  try {
    // Get parent job
    const parentJob = await db.jobs.get(parentJobId);
    if (!parentJob) {
      console.error('Parent job not found:', parentJobId);
      return;
    }

    // Get all child jobs
    const childJobs = await getJobsByParent(parentJobId);
    const childJobIds = childJobs.map(job => job.id);

    console.log(`Starting bulk fetch for ${childJobIds.length} URLs`);

    // Process in batches
    for (let i = 0; i < childJobIds.length; i += CONCURRENCY) {
      const batch = childJobIds.slice(i, i + CONCURRENCY);

      console.log(`Processing batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(childJobIds.length / CONCURRENCY)}`);

      await Promise.allSettled(
        batch.map(jobId => processSingleFetch(jobId, parentJobId))
      );
    }

    // Complete parent job
    const finalParentJob = await db.jobs.get(parentJobId);
    if (finalParentJob) {
      await completeJob(parentJobId, finalParentJob.metadata);
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
    await db.jobs.where('id').equals(parentJobId).modify(job => {
      job.metadata.successCount = (job.metadata.successCount || 0) + 1;
      const total = job.metadata.totalUrls || 1;
      const completed = (job.metadata.successCount || 0) + (job.metadata.failureCount || 0);
      job.progress = Math.round((completed / total) * 100);
      job.updatedAt = new Date();
    });

  } catch (error) {
    console.error(`Error fetching URL:`, error);

    // Update fetch job as failed
    await failJob(jobId, error instanceof Error ? error : String(error));

    // Update parent job failure count and progress
    await db.jobs.where('id').equals(parentJobId).modify(job => {
      job.metadata.failureCount = (job.metadata.failureCount || 0) + 1;
      const total = job.metadata.totalUrls || 1;
      const completed = (job.metadata.successCount || 0) + (job.metadata.failureCount || 0);
      job.progress = Math.round((completed / total) * 100);
      job.updatedAt = new Date();
    });
  }
}

/**
 * Ensure offscreen document exists (Chrome only)
 */
export async function ensureOffscreenDocument(): Promise<void> {
  // Check if we're in Chrome and have offscreen API
  if (typeof chrome !== 'undefined' && chrome.offscreen) {
    try {
      // Check if offscreen document already exists
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      });

      if (existingContexts.length > 0) {
        return; // Already exists
      }

      // Create offscreen document
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['DOM_SCRAPING' as chrome.offscreen.Reason],
        justification: 'Fetch URLs for bulk bookmark import',
      });

      console.log('Offscreen document created');
    } catch (error) {
      console.error('Error creating offscreen document:', error);
    }
  }
}
