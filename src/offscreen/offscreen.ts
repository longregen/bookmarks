/**
 * Offscreen document for Chrome extension
 * Handles URL fetching since service workers can't use fetch in Chrome MV3
 */

import { fetchWithTimeout } from '../lib/browser-fetch';

console.log('Offscreen document loaded');

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL') {
    const { url, timeoutMs } = message;

    fetchWithTimeout(url, timeoutMs || 30000)
      .then(html => {
        sendResponse({ success: true, html });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true; // Keep message channel open for async response
  }

  return false;
});
