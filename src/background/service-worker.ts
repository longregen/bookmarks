import { db, JobType, JobStatus } from '../db/schema';
import { startProcessingQueue } from './queue';
import { createJob, completeJob, failJob } from '../lib/jobs';
import { createBulkImportJob } from '../lib/bulk-import';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';

console.log('Bookmark RAG service worker loaded');

// Initialize the database and start processing queue on startup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing queue');
  startProcessingQueue();
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_BOOKMARK') {
    handleSaveBookmark(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_CURRENT_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab) {
        sendResponse({
          url: tab.url,
          title: tab.title,
        });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
    return true;
  }

  if (message.type === 'START_BULK_IMPORT') {
    handleBulkImport(message.urls)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_JOB_STATUS') {
    handleGetJobStatus(message.jobId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Handle FETCH_URL messages from offscreen document (Chrome only)
  if (message.type === 'FETCH_URL' && !sender.tab) {
    // This message should be forwarded to offscreen document
    // The offscreen document will handle it and respond
    return false;
  }

  return false;
});

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-bookmark') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab.id) return;

      // Inject and execute the content script to capture the page
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE' });
          }
        });
      } catch (error) {
        console.error('Failed to inject content script:', error);
      }
    });
  }
});

async function handleSaveBookmark(data: { url: string; title: string; html: string }) {
  const startTime = Date.now();
  let jobId: string | undefined;

  try {
    const { url, title, html } = data;

    // Create MANUAL_ADD job
    const job = await createJob({
      type: JobType.MANUAL_ADD,
      status: JobStatus.IN_PROGRESS,
      metadata: {
        url,
        title,
        source: 'manual',
      },
    });
    jobId = job.id;

    // Check if bookmark already exists
    const existing = await db.bookmarks.where('url').equals(url).first();

    if (existing) {
      // Update existing bookmark
      const now = new Date();
      await db.bookmarks.update(existing.id, {
        title,
        html,
        status: 'pending',
        errorMessage: undefined,
        errorStack: undefined,
        updatedAt: now,
      });

      // Complete job
      const captureTimeMs = Date.now() - startTime;
      await completeJob(jobId, {
        url,
        title,
        htmlSize: html.length,
        captureTimeMs,
      });

      // Link job to bookmark
      await db.jobs.update(jobId, { bookmarkId: existing.id });

      // Trigger processing queue
      startProcessingQueue();

      return { success: true, bookmarkId: existing.id, updated: true };
    }

    // Create new bookmark
    const id = crypto.randomUUID();
    const now = new Date();

    await db.bookmarks.add({
      id,
      url,
      title,
      html,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    // Complete job
    const captureTimeMs = Date.now() - startTime;
    await completeJob(jobId, {
      url,
      title,
      htmlSize: html.length,
      captureTimeMs,
    });

    // Link job to bookmark
    await db.jobs.update(jobId, { bookmarkId: id });

    // Trigger processing queue
    startProcessingQueue();

    return { success: true, bookmarkId: id };
  } catch (error) {
    console.error('Error saving bookmark:', error);

    // Mark job as failed if it was created
    if (jobId) {
      await failJob(jobId, error instanceof Error ? error : String(error));
    }

    throw error;
  }
}

async function handleBulkImport(urls: string[]) {
  try {
    // Ensure offscreen document exists (Chrome only, tree-shaken from Firefox builds)
    if (__IS_CHROME__) {
      await ensureOffscreenDocument();
    }

    // Create bulk import job and child jobs
    const parentJobId = await createBulkImportJob(urls);

    // Start processing in background
    processBulkFetch(parentJobId).catch(error => {
      console.error('Error in bulk fetch processing:', error);
    });

    return {
      success: true,
      jobId: parentJobId,
      totalUrls: urls.length,
    };
  } catch (error) {
    console.error('Error starting bulk import:', error);
    throw error;
  }
}

async function handleGetJobStatus(jobId: string) {
  try {
    const job = await db.jobs.get(jobId);

    if (!job) {
      return {
        success: false,
        error: 'Job not found',
      };
    }

    return {
      success: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        currentStep: job.currentStep,
        metadata: job.metadata,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      },
    };
  } catch (error) {
    console.error('Error getting job status:', error);
    throw error;
  }
}
