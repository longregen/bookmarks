import { showStatusMessage } from '../lib/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const navLibrary = document.getElementById('navLibrary') as HTMLButtonElement;
const navSearch = document.getElementById('navSearch') as HTMLButtonElement;
const navStumble = document.getElementById('navStumble') as HTMLButtonElement;
const navSettings = document.getElementById('navSettings') as HTMLButtonElement;


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
navLibrary.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
});

navSearch.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/search/search.html') });
});

navStumble.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/stumble/stumble.html') });
});

navSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
});

// Initialize theme
initExtension();
onThemeChange((theme) => applyTheme(theme));
