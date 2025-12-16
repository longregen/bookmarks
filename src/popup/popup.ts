import { showStatusMessage } from '../lib/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { openExtensionPage } from '../lib/tabs';

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
    const result = await chrome.scripting.executeScript({
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

    // Extract bookmarkId from response
    const response = result[0]?.result;
    if (response?.success && response?.bookmarkId) {
      showSuccessWithCTA(response.bookmarkId);
    } else {
      showStatusMessage(statusDiv, 'Bookmark saved!', 'success');
    }
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

function showSuccessWithCTA(bookmarkId: string) {
  statusDiv.className = 'status success';
  statusDiv.innerHTML = '';

  const message = document.createElement('div');
  message.textContent = 'Bookmark saved!';
  message.style.marginBottom = 'var(--space-2)';

  const ctaBtn = document.createElement('button');
  ctaBtn.className = 'btn-cta';
  ctaBtn.textContent = 'View in Library';
  ctaBtn.onclick = () => {
    openExtensionPage(`src/library/library.html?bookmarkId=${bookmarkId}`);
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(ctaBtn);
}

// Navigation button handlers
navLibrary.addEventListener('click', () => {
  openExtensionPage('src/library/library.html');
});

navSearch.addEventListener('click', () => {
  openExtensionPage('src/search/search.html');
});

navStumble.addEventListener('click', () => {
  openExtensionPage('src/stumble/stumble.html');
});

navSettings.addEventListener('click', () => {
  openExtensionPage('src/options/options.html');
});

// Initialize theme
initExtension();
onThemeChange((theme) => applyTheme(theme));
