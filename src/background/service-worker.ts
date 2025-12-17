import { db } from '../db/schema';
import { startProcessingQueue } from './queue';
import { createBulkImportJob } from '../lib/bulk-import';
import { ensureOffscreenDocument } from '../lib/offscreen';
import { setPlatformAdapter } from '../lib/platform';
import { extensionAdapter } from '../lib/adapters/extension';
import { getSettings } from '../lib/settings';
import { getErrorMessage } from '../lib/errors';
import { performSync, getSyncStatus, triggerSyncIfEnabled } from '../lib/webdav-sync';
import type {
  Message,
  SaveBookmarkResponse,
  StartBulkImportResponse,
} from '../lib/messages';

setPlatformAdapter(extensionAdapter);

console.log('Bookmark RAG service worker loaded');

const WEBDAV_SYNC_ALARM = 'webdav-sync';

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

async function initializeExtension(): Promise<void> {
  console.log('Initializing extension...');

  try {
    void startProcessingQueue();

    void setupSyncAlarm().catch((err: unknown) => {
      console.error('Error setting up sync alarm:', err);
    });

    triggerSyncIfEnabled().catch((err: unknown) => {
      console.error('Initial WebDAV sync failed:', err);
    });
  } catch (error) {
    console.error('Error during initialization:', error);
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

void initializeExtension();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WEBDAV_SYNC_ALARM) {
    console.log('WebDAV sync alarm triggered');
    try {
      await triggerSyncIfEnabled();
    } catch (err) {
      console.error('WebDAV sync alarm failed:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'SAVE_BOOKMARK') {
    handleSaveBookmark(message.data)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'START_BULK_IMPORT') {
    handleBulkImport(message.urls)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'TRIGGER_SYNC') {
    performSync(true)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'GET_SYNC_STATUS') {
    getSyncStatus()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'UPDATE_SYNC_SETTINGS') {
    setupSyncAlarm()
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'GET_CURRENT_TAB_INFO') {
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

  if (message.type === 'START_PROCESSING') {
    void startProcessingQueue();
    sendResponse({ success: true });
    return true;
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
  return { success: true, bookmarkId: id };
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
