import { db } from '../db/schema';
import { startProcessingQueue } from './queue';
import { createBulkImportJob } from '../lib/bulk-import';
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

function initializeExtension(): void {
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

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated');
  initializeExtension();

  if (details.reason === 'install') {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('src/welcome/welcome.html')
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing');
  initializeExtension();
});

initializeExtension();

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

  if (message.type === 'sync:trigger') {
    performSync(true)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ success: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === 'query:sync_status') {
    getSyncStatus()
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

  // IMPORTANT: Don't return false for offscreen document messages.
  // These are handled by the offscreen document. Returning false closes the
  // message port before the offscreen document can respond.
  if (message.type === 'extract:markdown_from_html' || message.type === 'offscreen:ping') {
    return;  // Return undefined to keep port open for offscreen document
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
    // Dynamic import to enable tree-shaking of offscreen module in Firefox builds
    const { ensureOffscreenDocument } = await import('../lib/offscreen');
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
