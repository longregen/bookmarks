import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage } from '../../lib/dom';
import { createPoller, type Poller } from '../../lib/polling-manager';
import { validateWebDAVUrl as validateWebDAVUrlShared } from '../../lib/url-validator';
import { withButtonState } from '../../lib/form-helper';
import type { UpdateSyncSettingsResponse, SyncStatus, TriggerSyncResponse } from '../../lib/messages';
import { getErrorMessage } from '../../lib/errors';

// WebDAV form elements
const webdavForm = document.getElementById('webdavForm') as HTMLFormElement;
const webdavEnabledInput = document.getElementById('webdavEnabled') as HTMLInputElement;
const webdavFieldsDiv = document.getElementById('webdavFields') as HTMLDivElement;
const webdavUrlInput = document.getElementById('webdavUrl') as HTMLInputElement;
const webdavUsernameInput = document.getElementById('webdavUsername') as HTMLInputElement;
const webdavPasswordInput = document.getElementById('webdavPassword') as HTMLInputElement;
const webdavPathInput = document.getElementById('webdavPath') as HTMLInputElement;
const webdavSyncIntervalInput = document.getElementById('webdavSyncInterval') as HTMLInputElement;
const webdavAllowInsecureInput = document.getElementById('webdavAllowInsecure') as HTMLInputElement;
const testWebdavBtn = document.getElementById('testWebdavBtn') as HTMLButtonElement;
const webdavConnectionStatus = document.getElementById('webdavConnectionStatus') as HTMLDivElement;
const webdavUrlWarning = document.getElementById('webdavUrlWarning') as HTMLDivElement;

// Sync status elements
const syncStatusIndicator = document.getElementById('syncStatusIndicator') as HTMLDivElement;
const syncNowBtn = document.getElementById('syncNowBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const syncStatusPoller: Poller = createPoller(
  () => updateSyncStatus(),
  10000 // Poll every 10 seconds
);

async function loadWebDAVSettings() {
  try {
    const settings = await getSettings();

    webdavEnabledInput.checked = settings.webdavEnabled;
    webdavUrlInput.value = settings.webdavUrl;
    webdavUsernameInput.value = settings.webdavUsername;
    webdavPasswordInput.value = settings.webdavPassword;
    webdavPathInput.value = settings.webdavPath;
    webdavSyncIntervalInput.value = String(settings.webdavSyncInterval || 15);
    webdavAllowInsecureInput.checked = settings.webdavAllowInsecure || false;

    // Show/hide fields based on enabled state
    updateWebDAVFieldsVisibility();

    // Validate URL and show warning if HTTP
    validateWebDAVUrl();

    // Load sync status if enabled
    if (settings.webdavEnabled) {
      updateSyncStatus();
    }
  } catch (error) {
    console.error('Error loading WebDAV settings:', error);
  }
}

function updateWebDAVFieldsVisibility() {
  if (webdavEnabledInput.checked) {
    webdavFieldsDiv.classList.remove('hidden');
  } else {
    webdavFieldsDiv.classList.add('hidden');
  }
}

function validateWebDAVUrl() {
  const url = webdavUrlInput.value.trim();

  if (!url) {
    webdavUrlWarning.classList.add('hidden');
    return;
  }

  // Use shared validation utility
  // Note: We pass allowInsecure=true here to get a warning instead of an error for HTTP
  const result = validateWebDAVUrlShared(url, true);

  if (result.valid && result.warning) {
    // HTTP URL detected - show warning
    webdavUrlWarning.classList.remove('hidden');
  } else {
    webdavUrlWarning.classList.add('hidden');
  }
}

webdavEnabledInput.addEventListener('change', updateWebDAVFieldsVisibility);
webdavUrlInput.addEventListener('input', validateWebDAVUrl);

webdavForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = webdavForm.querySelector('[type="submit"]') as HTMLButtonElement;

  try {
    await withButtonState(submitBtn, 'Saving...', async () => {
      await saveSetting('webdavEnabled', webdavEnabledInput.checked);
      await saveSetting('webdavUrl', webdavUrlInput.value.trim());
      await saveSetting('webdavUsername', webdavUsernameInput.value.trim());
      await saveSetting('webdavPassword', webdavPasswordInput.value);
      await saveSetting('webdavPath', webdavPathInput.value.trim() || '/bookmarks');
      await saveSetting('webdavSyncInterval', parseInt(webdavSyncIntervalInput.value, 10) || 15);

      // Notify service worker to update sync alarm
      await chrome.runtime.sendMessage({ type: 'UPDATE_SYNC_SETTINGS' }) as UpdateSyncSettingsResponse;
    });

    showStatusMessage(statusDiv, 'WebDAV settings saved successfully!', 'success', 5000);

    // Update sync status display
    if (webdavEnabledInput.checked) {
      updateSyncStatus();
    }
  } catch (error) {
    console.error('Error saving WebDAV settings:', error);
    showStatusMessage(statusDiv, 'Failed to save WebDAV settings', 'error', 5000);
  }
});

testWebdavBtn.addEventListener('click', async () => {
  const url = webdavUrlInput.value.trim();
  const username = webdavUsernameInput.value.trim();
  const password = webdavPasswordInput.value;

  if (!url || !username || !password) {
    showConnectionStatus('error', 'Please fill in URL, username, and password');
    return;
  }

  showConnectionStatus('testing', 'Testing connection...');

  try {
    await withButtonState(testWebdavBtn, 'Testing...', async () => {
      const result = await testWebDAVConnection(url, username, password);

      if (result.success) {
        showConnectionStatus('success', 'Connection successful!');
      } else {
        showConnectionStatus('error', result.error || 'Connection failed');
      }
    });
  } catch (error) {
    showConnectionStatus('error', `Connection failed: ${getErrorMessage(error)}`);
  }
});

function showConnectionStatus(type: 'success' | 'error' | 'testing', message: string) {
  webdavConnectionStatus.className = `connection-status ${type}`;
  const statusText = webdavConnectionStatus.querySelector('.status-text');
  if (statusText) {
    statusText.textContent = message;
  }
}

interface WebDAVTestResult {
  success: boolean;
  error?: string;
}

async function testWebDAVConnection(
  url: string,
  username: string,
  password: string
): Promise<WebDAVTestResult> {
  try {
    // Use PROPFIND to test WebDAV connection
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Depth': '0',
        'Authorization': 'Basic ' + btoa(`${username}:${password}`),
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
    });

    // WebDAV returns 207 Multi-Status for successful PROPFIND
    if (response.status === 207 || response.ok) {
      return { success: true };
    }

    if (response.status === 401) {
      return { success: false, error: 'Authentication failed. Check username and password.' };
    }

    if (response.status === 404) {
      return { success: false, error: 'Path not found. Check the server URL.' };
    }

    return { success: false, error: `Server returned status ${response.status}` };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { success: false, error: 'Network error. Check the URL and your connection.' };
    }
    throw error;
  }
}

// Sync status functions
async function updateSyncStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' }) as SyncStatus;

    if (response) {
      const statusText = syncStatusIndicator.querySelector('.sync-status-text') as HTMLSpanElement;

      // Remove existing status classes
      syncStatusIndicator.classList.remove('syncing', 'success', 'error');

      if (response.isSyncing) {
        syncStatusIndicator.classList.add('syncing');
        statusText.textContent = 'Syncing...';
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';
      } else if (response.lastSyncError) {
        syncStatusIndicator.classList.add('error');
        statusText.textContent = `Error: ${response.lastSyncError}`;
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
      } else if (response.lastSyncTime) {
        syncStatusIndicator.classList.add('success');
        statusText.textContent = `Last synced: ${formatSyncTime(response.lastSyncTime)}`;
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
      } else {
        statusText.textContent = 'Not synced yet';
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now';
      }
    }
  } catch (error) {
    console.error('Error getting sync status:', error);
  }
}

function formatSyncTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else {
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
}

syncNowBtn.addEventListener('click', async () => {
  try {
    await withButtonState(syncNowBtn, 'Syncing...', async () => {
      const statusText = syncStatusIndicator.querySelector('.sync-status-text') as HTMLSpanElement;
      syncStatusIndicator.classList.remove('success', 'error');
      syncStatusIndicator.classList.add('syncing');
      statusText.textContent = 'Syncing...';

      const result = await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' }) as TriggerSyncResponse;

      syncStatusIndicator.classList.remove('syncing');

      if (result && result.success) {
        syncStatusIndicator.classList.add('success');
        statusText.textContent = result.message ?? 'Sync completed';
        showStatusMessage(statusDiv, `Sync completed: ${result.message ?? 'Success'}`, 'success', 5000);
      } else {
        syncStatusIndicator.classList.add('error');
        statusText.textContent = `Error: ${result?.message || 'Unknown error'}`;
        showStatusMessage(statusDiv, `Sync failed: ${result?.message || 'Unknown error'}`, 'error', 5000);
      }

      // Refresh status after a short delay
      setTimeout(updateSyncStatus, 1000);
    });
  } catch (error) {
    console.error('Error triggering sync:', error);
    showStatusMessage(statusDiv, 'Failed to trigger sync', 'error', 5000);
  }
});

// Poll for sync status while on the options page
function startSyncStatusPolling() {
  syncStatusPoller.stop();

  // Only poll if WebDAV is enabled
  if (webdavEnabledInput.checked) {
    syncStatusPoller.start();
  }
}

function stopSyncStatusPolling() {
  syncStatusPoller.stop();
}

export function initWebDAVModule() {
  loadWebDAVSettings();
  startSyncStatusPolling();

  // Return cleanup function
  return () => {
    stopSyncStatusPolling();
  };
}
