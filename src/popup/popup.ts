import { showStatusMessage, getElement, createElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { openExtensionPage } from '../lib/tabs';
import { getSettings } from '../lib/settings';
import type { SaveBookmarkResponse } from '../lib/messages';
import { getErrorMessage } from '../lib/errors';

const saveBtn = getElement<HTMLButtonElement>('saveBtn');
const statusDiv = getElement<HTMLDivElement>('status');
const navLibrary = getElement<HTMLButtonElement>('navLibrary');
const navSearch = getElement<HTMLButtonElement>('navSearch');
const navStumble = getElement<HTMLButtonElement>('navStumble');
const navSettings = getElement<HTMLButtonElement>('navSettings');
const searchInput = getElement<HTMLInputElement>('searchInput');
const searchBtn = getElement<HTMLButtonElement>('searchBtn');


saveBtn.addEventListener('click', async () => {
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.id === undefined) {
      showStatusMessage(statusDiv, 'No active tab found', 'error');
      return;
    }

    if (tab.url === undefined || tab.url === '') {
      showStatusMessage(statusDiv, 'Cannot save in incognito mode or restricted URLs', 'error');
      return;
    }

    const restrictedSchemes = ['chrome:', 'about:', 'chrome-extension:', 'edge:', 'moz-extension:'];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (restrictedSchemes.some(scheme => tab.url!.startsWith(scheme))) {
      showStatusMessage(statusDiv, 'Cannot save browser internal pages', 'error');
      return;
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const url = location.href;
        const title = document.title;
        const html = document.documentElement.outerHTML;

        return await chrome.runtime.sendMessage({
          type: 'SAVE_BOOKMARK',
          data: { url, title, html }
        }) as unknown;
      }
    });

    const response: SaveBookmarkResponse | undefined = result[0]?.result as SaveBookmarkResponse | undefined;
    if (response?.success === true && response.bookmarkId !== undefined) {
      showSuccessWithCTA(response.bookmarkId);
    } else {
      showStatusMessage(statusDiv, 'Bookmark saved!', 'success', 3000);
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('Cannot access') || errorMessage.includes('scripting')) {
      showStatusMessage(statusDiv, 'Cannot access this page (permissions or restrictions)', 'error');
    } else {
      showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '';
    saveBtn.appendChild(createElement('span', { className: 'icon', textContent: '📌' }));
    saveBtn.appendChild(document.createTextNode(' Save This Page'));
  }
});

function showSuccessWithCTA(bookmarkId: string): void {
  statusDiv.className = 'status success success-with-cta';
  statusDiv.textContent = '';

  const message = createElement('span', { className: 'success-message', textContent: 'Bookmark saved!' });
  const ctaBtn = createElement('button', { className: 'btn-cta', textContent: 'View in Library' });
  ctaBtn.onclick = () => {
    void openExtensionPage(`src/library/library.html?bookmarkId=${bookmarkId}`);
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(ctaBtn);
}

navLibrary.addEventListener('click', () => {
  void openExtensionPage('src/library/library.html');
});

navSearch.addEventListener('click', () => {
  void openExtensionPage('src/search/search.html');
});

navStumble.addEventListener('click', () => {
  void openExtensionPage('src/stumble/stumble.html');
});

navSettings.addEventListener('click', () => {
  void openExtensionPage('src/options/options.html');
});

function performSearch(): void {
  const query = searchInput.value.trim();
  if (query) {
    void openExtensionPage(`src/search/search.html?q=${encodeURIComponent(query)}`);
  } else {
    void openExtensionPage('src/search/search.html');
  }
}

searchBtn.addEventListener('click', performSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

searchInput.focus();

void initExtension();
onThemeChange((theme) => applyTheme(theme));

async function checkEndpointConfiguration(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      showConfigurationWarning();
    }
  } catch (error) {
    console.error('Error checking settings:', error);
  }
}

function showConfigurationWarning(): void {
  statusDiv.className = 'status warning';
  statusDiv.textContent = '';

  const message = createElement('span', { textContent: 'API endpoint not configured.' });
  const settingsLink = createElement('button', { className: 'btn-cta', textContent: 'Configure in Settings' });
  settingsLink.onclick = () => {
    void openExtensionPage('src/options/options.html');
  };

  statusDiv.appendChild(message);
  statusDiv.appendChild(settingsLink);
}

void checkEndpointConfiguration();
