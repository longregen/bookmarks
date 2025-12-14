import { db } from '../db/schema';
import { startProcessingQueue } from './queue';

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
  try {
    const { url, title, html } = data;

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

    // Trigger processing queue
    startProcessingQueue();

    return { success: true, bookmarkId: id };
  } catch (error) {
    console.error('Error saving bookmark:', error);
    throw error;
  }
}
