import { showStatusMessage } from '../lib/dom';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const libraryBtn = document.getElementById('libraryBtn') as HTMLButtonElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const stumbleBtn = document.getElementById('stumbleBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;


saveBtn.addEventListener('click', async () => {
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      showStatusMessage(statusDiv, 'No active tab found', 'error');
      return;
    }

    // Inject content script to capture the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const url = location.href;
        const title = document.title;
        const html = document.documentElement.outerHTML;

        return await chrome.runtime.sendMessage({
          type: 'SAVE_BOOKMARK',
          data: { url, title, html }
        });
      }
    });

    showStatusMessage(statusDiv, 'Bookmark saved!', 'success');
  } catch (error) {
    console.error('Error saving bookmark:', error);
    showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
  } finally {
    saveBtn.disabled = false;
    // Use DOM APIs instead of innerHTML (CSP-safe)
    saveBtn.textContent = '';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.textContent = '📌';
    saveBtn.appendChild(iconSpan);
    saveBtn.appendChild(document.createTextNode(' Save This Page'));
  }
});

// Navigation button handlers
libraryBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
});

searchBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/search/search.html') });
});

stumbleBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/stumble/stumble.html') });
});

settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
});

// Initialize theme
initTheme();
onThemeChange((theme) => applyTheme(theme));
