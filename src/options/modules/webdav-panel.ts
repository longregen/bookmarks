import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage } from '../../lib/dom';
import { onEvent, EventType, type SyncStatusData } from '../../lib/events';

interface WebDAVTestResult {
  success: boolean;
  error?: string;
}

export function initializeWebDAVPanel() {
  const statusDiv = document.getElementById('status') as HTMLDivElement;
  const webdavForm = document.getElementById('webdavForm') as HTMLFormElement;
  const webdavEnabledInput = document.getElementById('webdavEnabled') as HTMLInputElement;
  const webdavFieldsDiv = document.getElementById('webdavFields') as HTMLDivElement;
  const webdavUrlInput = document.getElementById('webdavUrl') as HTMLInputElement;
  const webdavUsernameInput = document.getElementById('webdavUsername') as HTMLInputElement;
  const webdavPasswordInput = document.getElementById('webdavPassword') as HTMLInputElement;
  const webdavPathInput = document.getElementById('webdavPath') as HTMLInputElement;
  const webdavSyncIntervalInput = document.getElementById('webdavSyncInterval') as HTMLInputElement;
  const webdavAllowInsecureHTTPInput = document.getElementById('webdavAllowInsecureHTTP') as HTMLInputElement;
  const httpWarning = document.getElementById('httpWarning') as HTMLDivElement;
  const testWebdavBtn = document.getElementById('testWebdavBtn') as HTMLButtonElement;
  const webdavConnectionStatus = document.getElementById('webdavConnectionStatus') as HTMLDivElement;

  // Sync status elements
  const syncStatusIndicator = document.getElementById('syncStatusIndicator') as HTMLDivElement;
  const syncNowBtn = document.getElementById('syncNowBtn') as HTMLButtonElement;

  let syncStatusPollInterval: number | null = null;
  let syncStatusUnsubscribe: (() => void) | null = null;

  // Load settings
  loadWebDAVSettings();

  // Enable/disable toggle handler
  webdavEnabledInput.addEventListener('change', updateWebDAVFieldsVisibility);

  // Check HTTP warning when URL or checkbox changes
  webdavUrlInput.addEventListener('input', checkHTTPWarning);
  webdavAllowInsecureHTTPInput.addEventListener('change', checkHTTPWarning);

  // Form submit handler
  webdavForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = webdavForm.querySelector('[type="submit"]') as HTMLButtonElement;

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      await saveSetting('webdavEnabled', webdavEnabledInput.checked);
      await saveSetting('webdavUrl', webdavUrlInput.value.trim());
      await saveSetting('webdavUsername', webdavUsernameInput.value.trim());
      await saveSetting('webdavPassword', webdavPasswordInput.value);
      await saveSetting('webdavPath', webdavPathInput.value.trim() || '/bookmarks');
      await saveSetting('webdavSyncInterval', parseInt(webdavSyncIntervalInput.value, 10) || 15);
      await saveSetting('webdavAllowInsecureHTTP', webdavAllowInsecureHTTPInput.checked);

      // Notify service worker to update sync alarm
      await chrome.runtime.sendMessage({ type: 'UPDATE_SYNC_SETTINGS' });

      showStatusMessage(statusDiv, 'WebDAV settings saved successfully!', 'success', 5000);

      // Update sync status display
      if (webdavEnabledInput.checked) {
        updateSyncStatus();
      }
    } catch (error) {
      console.error('Error saving WebDAV settings:', error);
      showStatusMessage(statusDiv, 'Failed to save WebDAV settings', 'error', 5000);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Settings';
    }
  });

  // Test connection button handler
  testWebdavBtn.addEventListener('click', async () => {
    const url = webdavUrlInput.value.trim();
    const username = webdavUsernameInput.value.trim();
    const password = webdavPasswordInput.value;

    if (!url || !username || !password) {
      showConnectionStatus('error', 'Please fill in URL, username, and password');
      return;
    }

    showConnectionStatus('testing', 'Testing connection...');
    testWebdavBtn.disabled = true;

    try {
      const result = await testWebDAVConnection(url, username, password);

      if (result.success) {
        // Show warning if error message present (HTTP warning)
        if (result.error) {
          showConnectionStatus('error', result.error);
        } else {
          showConnectionStatus('success', 'Connection successful!');
        }
      } else {
        showConnectionStatus('error', result.error || 'Connection failed');
      }
    } catch (error) {
      showConnectionStatus('error', `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      testWebdavBtn.disabled = false;
    }
  });

  // Sync now button handler
  syncNowBtn.addEventListener('click', async () => {
    try {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = 'Syncing...';

      const statusText = syncStatusIndicator.querySelector('.sync-status-text') as HTMLSpanElement;
      syncStatusIndicator.classList.remove('success', 'error');
      syncStatusIndicator.classList.add('syncing');
      statusText.textContent = 'Syncing...';

      const result = await chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' });

      syncStatusIndicator.classList.remove('syncing');

      if (result && result.success) {
        syncStatusIndicator.classList.add('success');
        statusText.textContent = result.message;
        showStatusMessage(statusDiv, `Sync completed: ${result.message}`, 'success', 5000);
      } else {
        syncStatusIndicator.classList.add('error');
        statusText.textContent = `Error: ${result?.message || 'Unknown error'}`;
        showStatusMessage(statusDiv, `Sync failed: ${result?.message || 'Unknown error'}`, 'error', 5000);
      }

      // Refresh status after a short delay
      setTimeout(updateSyncStatus, 1000);
    } catch (error) {
      console.error('Error triggering sync:', error);
      showStatusMessage(statusDiv, 'Failed to trigger sync', 'error', 5000);
    } finally {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = 'Sync Now';
    }
  });

  // Start sync status polling
  startSyncStatusPolling();

  // Cleanup function
  window.addEventListener('beforeunload', () => {
    if (syncStatusPollInterval) {
      clearInterval(syncStatusPollInterval);
    }
    if (syncStatusUnsubscribe) {
      syncStatusUnsubscribe();
    }
  });

  async function loadWebDAVSettings() {
    try {
      const settings = await getSettings();

      webdavEnabledInput.checked = settings.webdavEnabled;
      webdavUrlInput.value = settings.webdavUrl;
      webdavUsernameInput.value = settings.webdavUsername;
      webdavPasswordInput.value = settings.webdavPassword;
      webdavPathInput.value = settings.webdavPath;
      webdavSyncIntervalInput.value = String(settings.webdavSyncInterval || 15);
      webdavAllowInsecureHTTPInput.checked = settings.webdavAllowInsecureHTTP || false;

      // Show/hide fields based on enabled state
      updateWebDAVFieldsVisibility();

      // Check for HTTP and show warning
      checkHTTPWarning();

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

  function showConnectionStatus(type: 'success' | 'error' | 'testing', message: string) {
    webdavConnectionStatus.className = `connection-status ${type}`;
    const statusText = webdavConnectionStatus.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = message;
    }
  }

  async function testWebDAVConnection(
    url: string,
    username: string,
    password: string
  ): Promise<WebDAVTestResult> {
    try {
      // Check if URL uses HTTP (insecure)
      const urlObj = new URL(url);
      if (urlObj.protocol === 'http:') {
        const allowInsecure = webdavAllowInsecureHTTPInput.checked;
        if (!allowInsecure) {
          return {
            success: false,
            error: 'HTTP is not secure. Please use HTTPS or enable "Allow Insecure HTTP" to test.'
          };
        }
      }

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
        // Warn if using HTTP
        if (urlObj.protocol === 'http:') {
          return {
            success: true,
            error: 'WARNING: Connection successful but using insecure HTTP.'
          };
        }
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

  async function updateSyncStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });

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

  function startSyncStatusPolling() {
    // Clean up existing listeners and intervals
    if (syncStatusPollInterval) {
      clearInterval(syncStatusPollInterval);
    }
    if (syncStatusUnsubscribe) {
      syncStatusUnsubscribe();
    }

    // Only listen/poll if WebDAV is enabled
    if (webdavEnabledInput.checked) {
      // Listen for sync status change events from background (event-driven)
      syncStatusUnsubscribe = onEvent<SyncStatusData>(
        EventType.SYNC_STATUS_CHANGED,
        (status) => {
          // Update UI when sync status changes
          updateSyncStatusFromData(status);
        }
      );

      // Also set up a fallback poll with a much longer interval (60s) for reliability
      syncStatusPollInterval = window.setInterval(async () => {
        await updateSyncStatus();
      }, 60000); // Fallback poll every 60 seconds
    }
  }

  /**
   * Helper to update sync status UI from status data
   */
  function updateSyncStatusFromData(status: SyncStatusData) {
    const statusText = syncStatusIndicator.querySelector('.sync-status-text') as HTMLSpanElement;

    // Remove existing status classes
    syncStatusIndicator.classList.remove('syncing', 'success', 'error');

    if (status.isSyncing) {
      syncStatusIndicator.classList.add('syncing');
      statusText.textContent = 'Syncing...';
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = 'Syncing...';
    } else if (status.lastSyncError) {
      syncStatusIndicator.classList.add('error');
      statusText.textContent = `Error: ${status.lastSyncError}`;
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = 'Sync Now';
    } else if (status.lastSyncTime) {
      syncStatusIndicator.classList.add('success');
      statusText.textContent = `Last synced: ${formatSyncTime(status.lastSyncTime)}`;
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = 'Sync Now';
    } else {
      statusText.textContent = 'Not synced yet';
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = 'Sync Now';
    }
  }

  /**
   * Check if WebDAV URL uses HTTP and show/hide warning accordingly
   */
  function checkHTTPWarning() {
    const url = webdavUrlInput.value.trim();
    const allowInsecure = webdavAllowInsecureHTTPInput.checked;

    if (!url) {
      httpWarning.classList.add('hidden');
      return;
    }

    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === 'http:' && !allowInsecure) {
        httpWarning.classList.remove('hidden');
      } else {
        httpWarning.classList.add('hidden');
      }
    } catch {
      // Invalid URL, hide warning
      httpWarning.classList.add('hidden');
    }
  }

  // Listen for URL/checkbox changes to check for HTTP warning
  webdavUrlInput.addEventListener('input', checkHTTPWarning);
  webdavAllowInsecureHTTPInput.addEventListener('change', checkHTTPWarning);
}
