import { showStatusMessage } from '../lib/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { openExtensionPage } from '../lib/tabs';
import { getSettings } from '../lib/settings';
import type { SaveBookmarkResponse } from '../lib/messages';
import { getErrorMessage } from '../lib/errors';

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const navLibrary = document.getElementById('navLibrary') as HTMLButtonElement;
const navSearch = document.getElementById('navSearch') as HTMLButtonElement;
const navStumble = document.getElementById('navStumble') as HTMLButtonElement;
const navSettings = document.getElementById('navSettings') as HTMLButtonElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;


saveBtn.addEventListener('click', async () => {
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      showStatusMessage(statusDiv, 'No active tab found', 'error');
      return;
    }

    // Check if tab.url is accessible (undefined in incognito or restricted URLs)
    if (!tab.url) {
      showStatusMessage(statusDiv, 'Cannot save in incognito mode or restricted URLs', 'error');
      return;
    }

    // Check for restricted URL schemes that don't allow script injection
    const restrictedSchemes = ['chrome:', 'about:', 'chrome-extension:', 'edge:', 'moz-extension:'];
    if (restrictedSchemes.some(scheme => tab.url?.startsWith(scheme))) {
      showStatusMessage(statusDiv, 'Cannot save browser internal pages', 'error');
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
        }) as SaveBookmarkResponse;
      }
    });

    // Extract bookmarkId from response
    const response: SaveBookmarkResponse | undefined = result[0]?.result;
    if (response?.success && response?.bookmarkId) {
      showSuccessWithCTA(response.bookmarkId);
    } else {
      showStatusMessage(statusDiv, 'Bookmark saved!', 'success');
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);
    // Provide more specific error messages for common cases
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('Cannot access') || errorMessage.includes('scripting')) {
      showStatusMessage(statusDiv, 'Cannot access this page (permissions or restrictions)', 'error');
    } else {
      showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
    }
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
  statusDiv.className = 'status success success-with-cta';
  statusDiv.innerHTML = '';

  const message = document.createElement('span');
  message.className = 'success-message';
  message.textContent = 'Bookmark saved!';

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

// Search functionality
function performSearch() {
  const query = searchInput.value.trim();
  if (query) {
    openExtensionPage(`src/search/search.html?q=${encodeURIComponent(query)}`);
  } else {
    openExtensionPage('src/search/search.html');
  }
}

searchBtn.addEventListener('click', performSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// Ctrl+K shortcut to focus search
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// Focus search input on popup open
searchInput.focus();

// Initialize theme
initExtension();
onThemeChange((theme) => applyTheme(theme));

// Check for endpoint configuration
async function checkEndpointConfiguration() {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      showConfigurationWarning();
    }
  } catch (error) {
    console.error('Error checking settings:', error);
  }
}

function showConfigurationWarning() {
  statusDiv.className = 'status warning';
  statusDiv.innerHTML = '';

  const message = document.createElement('span');
  message.textContent = 'API endpoint not configured.';

  const settingsLink = document.createElement('button');
  settingsLink.className = 'btn-cta';
  settingsLink.textContent = 'Configure in Settings';
  settingsLink.onclick = () => {
    openExtensionPage('src/options/options.html');
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(settingsLink);
}

checkEndpointConfiguration();
