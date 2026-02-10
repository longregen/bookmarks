import { db } from '../db/schema';
import { startProcessingQueue } from './queue';
import { resumeIncompleteJobs } from './job-resumption';
import { createBulkImportJob } from '../lib/bulk-import';
import { setPlatformAdapter } from '../lib/platform';
import { extensionAdapter } from '../lib/adapters/extension';
import { getSettings } from '../lib/settings';
import { getErrorMessage } from '../lib/errors';
import { serverSync } from '../lib/server-sync';
import { ServerApiClient } from '../lib/server-api';
import { ensureOffscreenDocument } from '../lib/offscreen';
import type {
  Message,
  SaveBookmarkResponse,
  StartBulkImportResponse,
} from '../lib/messages';

setPlatformAdapter(extensionAdapter);

console.log('Bookmark RAG service worker loaded');

const SERVER_SYNC_ALARM = 'server-sync';
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

async function setupSyncAlarm(): Promise<void> {
  try {
    const settings = await getSettings();

    await chrome.alarms.clear(SERVER_SYNC_ALARM);

    if (settings.serverEnabled && settings.serverSessionToken) {
      await chrome.alarms.create(SERVER_SYNC_ALARM, {
        periodInMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
        delayInMinutes: 1,
      });
      console.log(`Server sync alarm set for every ${DEFAULT_SYNC_INTERVAL_MINUTES} minutes`);
    } else {
      console.log('Server sync alarm disabled');
    }
  } catch (error) {
    console.error('Error setting up sync alarm:', error);
  }
}

async function triggerServerSyncIfEnabled(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.serverEnabled || !settings.serverSessionToken) {
      return;
    }

    const result = await serverSync.incrementalSync();
    if (!result.success) {
      console.error('Server sync failed:', result.message);
    }
  } catch (error) {
    console.error('Server sync error:', error);
  }
}

let initialized = false;

async function initializeExtension(): Promise<void> {
  if (initialized) return;
  initialized = true;

  console.log('Initializing extension...');

  try {
    await resumeIncompleteJobs();
    void startProcessingQueue();

    void setupSyncAlarm();

    void triggerServerSyncIfEnabled();
  } catch (error) {
    console.error('Error during initialization:', error);
    void startProcessingQueue();
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated');
  void initializeExtension();

  if (details.reason === 'install') {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('src/welcome/welcome.html')
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing');
  void initializeExtension();
});

void initializeExtension();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SERVER_SYNC_ALARM) {
    console.log('Server sync alarm triggered');
    try {
      await triggerServerSyncIfEnabled();
    } catch (err) {
      console.error('Server sync alarm failed:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'bookmark:save_from_page') {
    handleSaveBookmark(message.data)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'import:create_from_url_list') {
    handleBulkImport(message.urls)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'query:current_tab_info') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs.at(0);
      if (tab === undefined) {
        sendResponse({ error: 'No active tab found' });
        return;
      }
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

  if (message.type === 'bookmark:retry') {
    void startProcessingQueue();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'sync:trigger') {
    serverSync.incrementalSync()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'query:sync_status') {
    serverSync.getSyncStatus()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'sync:update_settings') {
    setupSyncAlarm()
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'extract:markdown_from_html' || message.type === 'offscreen:ping') {
    return;
  }

  // offscreen:ready is sent by the offscreen document when it loads - just acknowledge
  if (message.type === 'offscreen:ready') {
    return;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-bookmark') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs.at(0);
      if (tab?.id === undefined) return;

      if (tab.url === undefined || tab.url === '') {
        console.warn('Cannot save bookmark: tab URL is undefined (incognito mode or restricted URL)');
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            void chrome.runtime.sendMessage({ type: 'user_request:capture_current_tab' });
          }
        });
      } catch (error) {
        console.error('Failed to inject content script:', error);
      }
    });
  }
});

async function handleSaveBookmark(data: { url: string; title: string; html: string }): Promise<SaveBookmarkResponse> {
  const { url, title, html } = data;

  const existing = await db.bookmarks.where('url').equals(url).first();

  if (existing) {
    await db.bookmarks.update(existing.id, {
      title,
      html,
      status: 'pending',
      errorMessage: undefined,
      updatedAt: new Date(),
    });

    void startProcessingQueue();
    void syncBookmarkToServer({ url, title, html }, existing.id);
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

  void startProcessingQueue();
  void syncBookmarkToServer({ url, title, html }, id);
  return { success: true, bookmarkId: id };
}

async function syncBookmarkToServer(data: { url: string; title: string; html: string }, bookmarkId: string): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.serverEnabled || !settings.serverSessionToken || !settings.serverUrl) {
      return;
    }

    const apiClient = new ServerApiClient(settings.serverUrl, settings.serverSessionToken);
    await apiClient.createBookmark(data);
  } catch (error) {
    console.warn('Server unreachable, queuing bookmark for offline sync:', error);
    await serverSync.queueOfflineChange({
      type: 'create',
      bookmarkId,
      data,
      timestamp: Date.now(),
    });
  }
}

async function handleBulkImport(urls: string[]): Promise<StartBulkImportResponse> {
  if (__IS_CHROME__) {
    await ensureOffscreenDocument();
  }

  const jobId = await createBulkImportJob(urls);

  void startProcessingQueue();

  return {
    success: true,
    jobId,
    totalUrls: urls.length,
  };
}
