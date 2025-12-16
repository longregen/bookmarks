import { db, JobType, JobStatus } from '../db/schema';
import { startProcessingQueue } from './queue';
import { createJob, completeJob, failJob } from '../lib/jobs';
import { createBulkImportJob } from '../lib/bulk-import';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';
import { resumeInterruptedJobs } from './job-resumption';
import { setPlatformAdapter } from '../lib/platform';
import { extensionAdapter } from '../lib/adapters/extension';
import { triggerSyncIfEnabled } from '../lib/webdav-sync';
import { getSettings } from '../lib/settings';

// Initialize platform adapter immediately (required for API calls)
setPlatformAdapter(extensionAdapter);

console.log('Bookmark RAG service worker loaded');

const WEBDAV_SYNC_ALARM = 'webdav-sync';

/**
 * Set up or update the WebDAV sync alarm based on settings
 */
async function setupSyncAlarm(): Promise<void> {
  try {
    const settings = await getSettings();

    // Clear existing alarm
    await chrome.alarms.clear(WEBDAV_SYNC_ALARM);

    // Only set up alarm if WebDAV is enabled and interval > 0
    if (settings.webdavEnabled && settings.webdavSyncInterval > 0) {
      await chrome.alarms.create(WEBDAV_SYNC_ALARM, {
        periodInMinutes: settings.webdavSyncInterval,
        delayInMinutes: 1, // First sync after 1 minute
      });
      console.log(`WebDAV sync alarm set for every ${settings.webdavSyncInterval} minutes`);
    } else {
      console.log('WebDAV sync alarm disabled');
    }
  } catch (error) {
    console.error('Error setting up sync alarm:', error);
  }
}

/**
 * Initialize the extension - check for interrupted jobs and start processing
 */
async function initializeExtension() {
  console.log('Initializing extension...');

  try {
    // First, check for and resume any interrupted jobs
    const { resumedBulkImports, resetFetchJobs } = await resumeInterruptedJobs();

    if (resumedBulkImports > 0 || resetFetchJobs > 0) {
      console.log(`Job recovery: resumed ${resumedBulkImports} bulk imports, reset ${resetFetchJobs} fetch jobs`);
    }

    // Then start the bookmark processing queue
    startProcessingQueue();

    // Set up WebDAV sync alarm
    await setupSyncAlarm();

    // Trigger initial sync if configured
    triggerSyncIfEnabled().catch(err => {
      console.error('Initial WebDAV sync failed:', err);
    });
  } catch (error) {
    console.error('Error during initialization:', error);
    // Still try to start the processing queue even if job recovery fails
    startProcessingQueue();
  }
}

// Initialize on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  initializeExtension();
});

// Initialize on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing');
  initializeExtension();
});

// Also initialize immediately when the service worker loads
// This handles cases where the service worker was killed and restarted
initializeExtension();

// Handle alarm for periodic WebDAV sync
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WEBDAV_SYNC_ALARM) {
    console.log('WebDAV sync alarm triggered');
    await triggerSyncIfEnabled();
  }
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

  if (message.type === 'START_PROCESSING') {
    // Ping to restart processing queue
    startProcessingQueue();
    sendResponse({ success: true });
    return true;
  }

  // Handle FETCH_URL messages from offscreen document (Chrome only)
  if (message.type === 'FETCH_URL' && !sender.tab) {
    // This message should be forwarded to offscreen document
    // The offscreen document will handle it and respond
    return false;
  }

  // WebDAV sync handlers
  if (message.type === 'TRIGGER_SYNC') {
    import('../lib/webdav-sync').then(({ performSync }) => {
      performSync(true).then(result => sendResponse(result));
    });
    return true;
  }

  if (message.type === 'GET_SYNC_STATUS') {
    import('../lib/webdav-sync').then(({ getSyncStatus }) => {
      getSyncStatus().then(status => sendResponse(status));
    });
    return true;
  }

  if (message.type === 'UPDATE_SYNC_SETTINGS') {
    // Re-setup the alarm when sync settings change
    setupSyncAlarm().then(() => sendResponse({ success: true }));
    return true;
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
