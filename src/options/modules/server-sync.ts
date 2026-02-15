import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage, getElement } from '../../ui/dom';
import { createPoller, type Poller } from '../../lib/polling-manager';
import { withButtonState } from '../../ui/form-helper';
import {
  authenticate,
  generateToken,
  logout,
  deleteAccount,
  isSessionValid,
} from '../../lib/server-auth';
import { getErrorMessage } from '../../lib/errors';
import { formatDateByAge } from '../../lib/date-format';
import { ServerApiClient } from '../../lib/server-api';

const SYNC_POLL_INTERVAL = 2000;

let statusPoller: Poller | null = null;

function updateAuthUI(isLoggedIn: boolean, tokenDisplay: string): void {
  const authSection = getElement('serverAuthSection');
  const loggedInSection = getElement('serverLoggedInSection');
  const tokenDisplayEl = getElement('serverTokenDisplay');

  if (isLoggedIn) {
    authSection.classList.add('hidden');
    loggedInSection.classList.remove('hidden');
    tokenDisplayEl.textContent = tokenDisplay;
  } else {
    authSection.classList.remove('hidden');
    loggedInSection.classList.add('hidden');
    tokenDisplayEl.textContent = '';
  }
}

function truncateToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function updateSyncStatus(lastSyncTime: string, lastError: string): void {
  const statusText = getElement('serverSyncStatusText');
  const statusIcon = getElement('serverSyncStatusIcon');

  if (lastError) {
    statusIcon.className = 'sync-status-icon error';
    statusText.textContent = `Error: ${lastError}`;
  } else if (lastSyncTime) {
    statusIcon.className = 'sync-status-icon success';
    const date = new Date(lastSyncTime);
    statusText.textContent = `Last synced ${formatDateByAge(date)}`;
  } else {
    statusIcon.className = 'sync-status-icon';
    statusText.textContent = 'Not synced yet';
  }
}

function updateFieldsVisibility(enabled: boolean): void {
  const fields = getElement('serverSyncFields');
  if (enabled) {
    fields.classList.remove('hidden');
  } else {
    fields.classList.add('hidden');
  }
}

async function notifySyncSettingsChanged(): Promise<void> {
  if (!__IS_WEB__) {
    try {
      await chrome.runtime.sendMessage({ type: 'sync:update_settings' });
    } catch {
      // Service worker may not be running
    }
  }
}

async function loadSettings(): Promise<void> {
  const settings = await getSettings();

  const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
  const urlInput = getElement<HTMLInputElement>('serverUrl');

  if (__IS_WEB__) {
    const enableToggle = enabledCheckbox.closest('.form-group') ?? enabledCheckbox.parentElement;
    if (enableToggle) {
      (enableToggle as HTMLElement).style.display = 'none';
    }
    updateFieldsVisibility(true);
  } else {
    enabledCheckbox.checked = settings.serverEnabled;
    updateFieldsVisibility(settings.serverEnabled);
  }

  urlInput.value = settings.serverUrl;

  const isLoggedIn =
    Boolean(settings.serverSessionToken) &&
    isSessionValid(settings.serverSessionExpiry);
  updateAuthUI(isLoggedIn, truncateToken(settings.serverAuthToken));
  updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);
}

async function handleEnableToggle(event: Event): Promise<void> {
  const checkbox = event.target as HTMLInputElement;
  const enabled = checkbox.checked;

  await saveSetting('serverEnabled', enabled);
  updateFieldsVisibility(enabled);
  await notifySyncSettingsChanged();
}

async function handleUrlSave(): Promise<void> {
  const urlInput = getElement<HTMLInputElement>('serverUrl');
  const statusDiv = getElement('status');

  const url = urlInput.value.trim();

  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    showStatusMessage(statusDiv, 'Server URL must start with http:// or https://', 'error');
    return;
  }

  await saveSetting('serverUrl', url);
  showStatusMessage(statusDiv, 'Server URL saved', 'success');
}

function handleGenerateToken(): void {
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const copyBtn = getElement<HTMLButtonElement>('serverCopyTokenBtn');

  tokenInput.value = generateToken();
  copyBtn.style.display = '';
}

async function handleCopyToken(): Promise<void> {
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const statusDiv = getElement('status');

  try {
    await navigator.clipboard.writeText(tokenInput.value);
    showStatusMessage(statusDiv, 'Token copied to clipboard', 'success');
  } catch {
    showStatusMessage(statusDiv, 'Failed to copy token', 'error');
  }
}

async function handleConnect(): Promise<void> {
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const connectBtn = getElement<HTMLButtonElement>('serverConnectBtn');
  const statusDiv = getElement('status');
  const urlInput = getElement<HTMLInputElement>('serverUrl');

  const token = tokenInput.value.trim();
  const serverUrl = urlInput.value.trim();

  if (!serverUrl) {
    showStatusMessage(statusDiv, 'Please enter a server URL first', 'error');
    return;
  }

  if (!token) {
    showStatusMessage(statusDiv, 'Please enter or generate a token', 'error');
    return;
  }

  try {
    const result = await withButtonState(connectBtn, 'Connecting...', () =>
      authenticate(serverUrl, token)
    );

    await saveSetting('serverUrl', serverUrl);
    await saveSetting('serverAuthToken', token);
    await saveSetting('serverEnabled', true);
    await notifySyncSettingsChanged();

    const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
    enabledCheckbox.checked = true;

    updateAuthUI(true, truncateToken(token));
    tokenInput.value = '';
    getElement<HTMLButtonElement>('serverCopyTokenBtn').style.display = 'none';

    const message = result.created ? 'Account created and connected!' : 'Connected successfully!';
    showStatusMessage(statusDiv, message, 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleLogout(): Promise<void> {
  const logoutBtn = getElement<HTMLButtonElement>('serverLogoutBtn');
  const statusDiv = getElement('status');

  const settings = await getSettings();

  try {
    await withButtonState(logoutBtn, 'Disconnecting...', async () => {
      await logout(settings.serverUrl, settings.serverSessionToken);
    });

    await saveSetting('serverAuthToken', '');
    await saveSetting('serverEnabled', false);
    await notifySyncSettingsChanged();

    const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
    enabledCheckbox.checked = false;

    updateAuthUI(false, '');
    showStatusMessage(statusDiv, 'Disconnected successfully', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleDeleteAccount(): Promise<void> {
  const deleteBtn = getElement<HTMLButtonElement>('serverDeleteAccountBtn');
  const statusDiv = getElement('status');

  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to delete all server data? This action cannot be undone.')) {
    return;
  }

  const settings = await getSettings();

  try {
    await withButtonState(deleteBtn, 'Deleting...', async () => {
      await deleteAccount(settings.serverUrl, settings.serverSessionToken);
    });

    await saveSetting('serverAuthToken', '');
    await saveSetting('serverEnabled', false);
    await notifySyncSettingsChanged();

    const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
    enabledCheckbox.checked = false;

    updateAuthUI(false, '');
    showStatusMessage(statusDiv, 'All server data deleted', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleSyncUp(): Promise<void> {
  const syncUpBtn = getElement<HTMLButtonElement>('serverSyncUpBtn');
  const statusDiv = getElement('status');

  const settings = await getSettings();

  if (!settings.serverSessionToken || !isSessionValid(settings.serverSessionExpiry)) {
    showStatusMessage(statusDiv, 'Please connect first', 'error');
    return;
  }

  try {
    await withButtonState(syncUpBtn, 'Uploading...', async () => {
      if (__IS_WEB__) {
        const { serverSync } = await import('../../lib/server-sync');
        const result = await serverSync.uploadAllBookmarks();
        if (!result.success) {
          throw new Error(result.message);
        }
      } else {
        const response: { success?: boolean; message?: string; error?: string } | undefined =
          await chrome.runtime.sendMessage({ type: 'sync:upload_all' });
        if (response?.success !== true) {
          throw new Error(response?.message ?? response?.error ?? 'Upload failed');
        }
      }
    });

    showStatusMessage(statusDiv, 'All bookmarks uploaded to server!', 'success');

    const updatedSettings = await getSettings();
    updateSyncStatus(updatedSettings.serverLastSyncTime, updatedSettings.serverLastSyncError);
  } catch (error) {
    showStatusMessage(statusDiv, `Upload failed: ${getErrorMessage(error)}`, 'error', 5000);
  }
}

async function handleSyncNow(): Promise<void> {
  const syncNowBtn = getElement<HTMLButtonElement>('serverSyncNowBtn');
  const statusDiv = getElement('status');

  const settings = await getSettings();

  if (!settings.serverUrl) {
    showStatusMessage(statusDiv, 'Please configure a server URL first', 'error');
    return;
  }

  if (!settings.serverSessionToken || !isSessionValid(settings.serverSessionExpiry)) {
    showStatusMessage(statusDiv, 'Please connect first', 'error');
    return;
  }

  try {
    await withButtonState(syncNowBtn, 'Syncing...', async () => {
      if (__IS_WEB__) {
        const { serverSync } = await import('../../lib/server-sync');
        await serverSync.incrementalSync();
      } else {
        const response: { success?: boolean; error?: string } | undefined = await chrome.runtime.sendMessage({ type: 'sync:trigger' });
        if (response?.success !== true) {
          throw new Error(response?.error ?? 'Sync failed');
        }
      }
    });

    const updatedSettings = await getSettings();
    updateSyncStatus(updatedSettings.serverLastSyncTime, updatedSettings.serverLastSyncError);

    if (updatedSettings.serverLastSyncError) {
      showStatusMessage(statusDiv, `Sync failed: ${updatedSettings.serverLastSyncError}`, 'error', 5000);
    } else {
      showStatusMessage(statusDiv, 'Sync completed successfully!', 'success');
    }
  } catch (error) {
    showStatusMessage(statusDiv, `Sync failed: ${getErrorMessage(error)}`, 'error', 5000);
  }
}

function isServerConnected(settings: { serverUrl: string; serverSessionToken: string; serverSessionExpiry: string }): boolean {
  return Boolean(settings.serverUrl) &&
    Boolean(settings.serverSessionToken) &&
    isSessionValid(settings.serverSessionExpiry);
}

async function handleReprocessAll(): Promise<void> {
  const reembedBtn = getElement<HTMLButtonElement>('serverReembedAllBtn');
  const statusDiv = getElement('status');

  const settings = await getSettings();
  const useServer = isServerConnected(settings);

  try {
    if (useServer) {
      const result = await withButtonState(reembedBtn, 'Queuing...', async () => {
        const client = new ServerApiClient(settings.serverUrl, settings.serverSessionToken);
        return client.reprocessAllBookmarks();
      });
      showStatusMessage(statusDiv, `Queued ${result.queued} bookmarks for re-embedding`, 'success');
    } else {
      const result = await withButtonState(reembedBtn, 'Queuing...', async () => {
        if (__IS_WEB__) {
          const { db } = await import('../../db/schema');
          const { startProcessingQueue } = await import('../../background/queue');
          let count = 0;
          await db.transaction('rw', db.bookmarks, async () => {
            const bookmarks = await db.bookmarks.where('status').anyOf(['complete', 'error']).toArray();
            count = bookmarks.length;
            for (const b of bookmarks) {
              await db.bookmarks.update(b.id, { status: 'pending' as const, retryCount: 0, errorMessage: undefined, updatedAt: new Date() });
            }
          });
          void startProcessingQueue();
          return { count };
        } else {
          const response: { success?: boolean; count?: number; error?: string } | undefined =
            await chrome.runtime.sendMessage({ type: 'bookmark:reprocess_all' });
          if (response?.success !== true) {
            throw new Error(response?.error ?? 'Reprocessing failed');
          }
          return { count: response.count ?? 0 };
        }
      });
      showStatusMessage(statusDiv, `Queued ${result.count} bookmarks for re-embedding`, 'success');
    }
  } catch (error) {
    showStatusMessage(statusDiv, `Re-embed failed: ${getErrorMessage(error)}`, 'error', 5000);
  }
}

async function pollSyncStatus(): Promise<void> {
  const settings = await getSettings();
  updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);
}

function startStatusPolling(): void {
  if (statusPoller) {
    statusPoller.stop();
  }
  statusPoller = createPoller(pollSyncStatus, SYNC_POLL_INTERVAL, { immediate: true });
  statusPoller.start();
}

function stopStatusPolling(): void {
  if (statusPoller) {
    statusPoller.stop();
    statusPoller = null;
  }
}

export function initServerSyncModule(): () => void {
  void loadSettings();

  const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
  const saveUrlBtn = getElement<HTMLButtonElement>('serverSaveUrlBtn');
  const generateTokenBtn = getElement<HTMLButtonElement>('serverGenerateTokenBtn');
  const copyTokenBtn = getElement<HTMLButtonElement>('serverCopyTokenBtn');
  const connectBtn = getElement<HTMLButtonElement>('serverConnectBtn');
  const logoutBtn = getElement<HTMLButtonElement>('serverLogoutBtn');
  const deleteAccountBtn = getElement<HTMLButtonElement>('serverDeleteAccountBtn');
  const syncNowBtn = getElement<HTMLButtonElement>('serverSyncNowBtn');
  const syncUpBtn = getElement<HTMLButtonElement>('serverSyncUpBtn');
  const reembedAllBtn = getElement<HTMLButtonElement>('serverReembedAllBtn');

  enabledCheckbox.addEventListener('change', (e) => void handleEnableToggle(e));
  saveUrlBtn.addEventListener('click', () => void handleUrlSave());
  generateTokenBtn.addEventListener('click', () => handleGenerateToken());
  copyTokenBtn.addEventListener('click', () => void handleCopyToken());
  connectBtn.addEventListener('click', () => void handleConnect());
  logoutBtn.addEventListener('click', () => void handleLogout());
  deleteAccountBtn.addEventListener('click', () => void handleDeleteAccount());
  syncNowBtn.addEventListener('click', () => void handleSyncNow());
  syncUpBtn.addEventListener('click', () => void handleSyncUp());
  reembedAllBtn.addEventListener('click', () => void handleReprocessAll());

  startStatusPolling();

  return () => {
    stopStatusPolling();
  };
}
