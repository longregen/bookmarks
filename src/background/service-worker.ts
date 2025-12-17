import { db, JobType, JobStatus } from '../db/schema';
import { startProcessingQueue } from './queue';
import { createJob, completeJob, failJob } from '../lib/jobs';
import { createBulkImportJob } from '../lib/bulk-import';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';
import { resumeInterruptedJobs } from './job-resumption';
import { setPlatformAdapter } from '../lib/platform';
import { extensionAdapter } from '../lib/adapters/extension';
import { getSettings } from '../lib/settings';
import { getErrorMessage } from '../lib/errors';
import type {
  Message,
  MessageHandler,
  SaveBookmarkResponse,
  StartBulkImportResponse,
  GetJobStatusResponse,
  TriggerSyncResponse as _TriggerSyncResponse,
  SyncStatus as _SyncStatus,
  UpdateSyncSettingsResponse as _UpdateSyncSettingsResponse,
} from '../lib/messages';

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

    await chrome.alarms.clear(WEBDAV_SYNC_ALARM);

    if (settings.webdavEnabled && settings.webdavSyncInterval > 0) {
      await chrome.alarms.create(WEBDAV_SYNC_ALARM, {
        periodInMinutes: settings.webdavSyncInterval,
        delayInMinutes: 1,
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
async function initializeExtension(): Promise<void> {
  console.log('Initializing extension...');

  try {
    const { resumedBulkImports, resetFetchJobs } = await resumeInterruptedJobs();

    if (resumedBulkImports > 0 || resetFetchJobs > 0) {
      console.log(`Job recovery: resumed ${resumedBulkImports} bulk imports, reset ${resetFetchJobs} fetch jobs`);
    }

    void startProcessingQueue();

    // Set up WebDAV sync alarm (don't await to prevent blocking)
    void setupSyncAlarm().catch((err: unknown) => {
      console.error('Error setting up sync alarm:', err);
    });

    void import('../lib/webdav-sync').then(({ triggerSyncIfEnabled }) => {
      triggerSyncIfEnabled().catch((err: unknown) => {
        console.error('Initial WebDAV sync failed:', err);
      });
    }).catch((err: unknown) => {
      console.error('Failed to load webdav-sync module:', err);
    });
  } catch (error) {
    console.error('Error during initialization:', error);
    // Still try to start the processing queue even if job recovery fails
    void startProcessingQueue();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing');
  void initializeExtension();
});

// Also initialize immediately when the service worker loads
// This handles cases where the service worker was killed and restarted
void initializeExtension();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WEBDAV_SYNC_ALARM) {
    console.log('WebDAV sync alarm triggered');
    try {
      const { triggerSyncIfEnabled } = await import('../lib/webdav-sync');
      await triggerSyncIfEnabled();
    } catch (err) {
      console.error('WebDAV sync alarm failed:', err);
    }
  }
});

const asyncMessageHandlers = {
  'SAVE_BOOKMARK': (async (msg) => handleSaveBookmark(msg.data)) as MessageHandler<'SAVE_BOOKMARK'>,
  'START_BULK_IMPORT': (async (msg) => handleBulkImport(msg.urls)) as MessageHandler<'START_BULK_IMPORT'>,
  'GET_JOB_STATUS': (async (msg) => handleGetJobStatus(msg.jobId)) as MessageHandler<'GET_JOB_STATUS'>,
  'TRIGGER_SYNC': (async () => import('../lib/webdav-sync').then(m => m.performSync(true))) as MessageHandler<'TRIGGER_SYNC'>,
  'GET_SYNC_STATUS': (async () => import('../lib/webdav-sync').then(m => m.getSyncStatus())) as MessageHandler<'GET_SYNC_STATUS'>,
  'UPDATE_SYNC_SETTINGS': (async () => {
    await setupSyncAlarm();
    return { success: true };
  }) as MessageHandler<'UPDATE_SYNC_SETTINGS'>,
} as const;

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type in asyncMessageHandlers) {
    const handler = asyncMessageHandlers[message.type as keyof typeof asyncMessageHandlers];
    // TypeScript can't narrow the union type automatically, so we use type assertion
    // This is safe because we've matched the type key
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    (handler as any)(message)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .then((result: any) => sendResponse(result))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_CURRENT_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (tab === undefined) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
      // tab.url and tab.title can be undefined in incognito mode or for restricted URLs
      if (tab.url !== undefined && tab.url !== '' && tab.title !== undefined && tab.title !== '') {
        sendResponse({
          url: tab.url,
          title: tab.title,
        });
      } else {
        sendResponse({
          error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
        });
      }
    });
    return true;
  }

  if (message.type === 'START_PROCESSING') {
    void startProcessingQueue();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FETCH_URL' && !sender.tab) {
    return false;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-bookmark') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
      if (!tab || tab.id === undefined || tab.id === 0) return;

      // Check if we can access the tab URL (may be undefined in incognito or restricted URLs)
      if (tab.url === undefined || tab.url === '') {
        console.warn('Cannot save bookmark: tab URL is undefined (incognito mode or restricted URL)');
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            void chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE' });
          }
        });
      } catch (error) {
        console.error('Failed to inject content script:', error);
      }
    });
  }
});

async function handleSaveBookmark(data: { url: string; title: string; html: string }): Promise<SaveBookmarkResponse> {
  const startTime = Date.now();
  let jobId: string | undefined;

  try {
    const { url, title, html } = data;

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

    const existing = await db.bookmarks.where('url').equals(url).first();

    if (existing) {
      const now = new Date();
      await db.bookmarks.update(existing.id, {
        title,
        html,
        status: 'pending',
        errorMessage: undefined,
        errorStack: undefined,
        updatedAt: now,
      });

      const captureTimeMs = Date.now() - startTime;
      await completeJob(jobId, {
        url,
        title,
        htmlSize: html.length,
        captureTimeMs,
      });

      await db.jobs.update(jobId, { bookmarkId: existing.id });

      void startProcessingQueue();

      return { success: true, bookmarkId: existing.id, updated: true };
    }

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

    const captureTimeMs = Date.now() - startTime;
    await completeJob(jobId, {
      url,
      title,
      htmlSize: html.length,
      captureTimeMs,
    });

    await db.jobs.update(jobId, { bookmarkId: id });

    void startProcessingQueue();

    return { success: true, bookmarkId: id };
  } catch (error) {
    console.error('Error saving bookmark:', error);

    // Mark job as failed if it was created
    if (jobId !== undefined) {
      await failJob(jobId, getErrorMessage(error));
    }

    throw error;
  }
}

async function handleBulkImport(urls: string[]): Promise<StartBulkImportResponse> {
  try {
    // Ensure offscreen document exists (Chrome only, tree-shaken from Firefox builds)
    if (__IS_CHROME__) {
      await ensureOffscreenDocument();
    }

    const parentJobId = await createBulkImportJob(urls);

    void processBulkFetch(parentJobId).catch((error: unknown) => {
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

async function handleGetJobStatus(jobId: string): Promise<GetJobStatusResponse> {
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
