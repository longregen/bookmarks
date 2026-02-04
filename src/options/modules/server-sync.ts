import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage, getElement } from '../../ui/dom';
import { createPoller, type Poller } from '../../lib/polling-manager';
import { withButtonState } from '../../ui/form-helper';
import {
  registerWithPasskey,
  loginWithPasskey,
  logout,
  isSessionValid,
} from '../../lib/server-auth';
import { getErrorMessage } from '../../lib/errors';
import { formatDateByAge } from '../../lib/date-format';

const SYNC_POLL_INTERVAL = 2000;

let statusPoller: Poller | null = null;

function updateAuthUI(isLoggedIn: boolean, username: string): void {
  const authSection = getElement('serverAuthSection');
  const loggedInSection = getElement('serverLoggedInSection');
  const usernameDisplay = getElement('serverUsernameDisplay');

  if (isLoggedIn) {
    authSection.classList.add('hidden');
    loggedInSection.classList.remove('hidden');
    usernameDisplay.textContent = username;
  } else {
    authSection.classList.remove('hidden');
    loggedInSection.classList.add('hidden');
    usernameDisplay.textContent = '';
  }
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

async function loadSettings(): Promise<void> {
  const settings = await getSettings();

  const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
  const urlInput = getElement<HTMLInputElement>('serverUrl');

  enabledCheckbox.checked = settings.serverEnabled;
  urlInput.value = settings.serverUrl;

  updateFieldsVisibility(settings.serverEnabled);

  const isLoggedIn =
    Boolean(settings.serverSessionToken) &&
    isSessionValid(settings.serverSessionExpiry);
  updateAuthUI(isLoggedIn, settings.serverUsername);
  updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);
}

async function handleEnableToggle(event: Event): Promise<void> {
  const checkbox = event.target as HTMLInputElement;
  const enabled = checkbox.checked;

  await saveSetting('serverEnabled', enabled);
  updateFieldsVisibility(enabled);
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

async function handleRegister(): Promise<void> {
  const usernameInput = getElement<HTMLInputElement>('serverUsername');
  const registerBtn = getElement<HTMLButtonElement>('serverRegisterBtn');
  const statusDiv = getElement('status');
  const urlInput = getElement<HTMLInputElement>('serverUrl');

  const username = usernameInput.value.trim();
  const serverUrl = urlInput.value.trim();

  if (!serverUrl) {
    showStatusMessage(statusDiv, 'Please enter a server URL first', 'error');
    return;
  }

  if (!username) {
    showStatusMessage(statusDiv, 'Please enter a username', 'error');
    return;
  }

  try {
    const result = await withButtonState(registerBtn, 'Registering...', () =>
      registerWithPasskey(serverUrl, username)
    );

    await saveSetting('serverSessionToken', result.sessionToken);
    await saveSetting('serverSessionExpiry', result.sessionExpiry);
    await saveSetting('serverUsername', result.username);

    updateAuthUI(true, result.username);
    usernameInput.value = '';
    showStatusMessage(statusDiv, 'Registered successfully!', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleLogin(): Promise<void> {
  const loginBtn = getElement<HTMLButtonElement>('serverLoginBtn');
  const statusDiv = getElement('status');
  const urlInput = getElement<HTMLInputElement>('serverUrl');

  const serverUrl = urlInput.value.trim();

  if (!serverUrl) {
    showStatusMessage(statusDiv, 'Please enter a server URL first', 'error');
    return;
  }

  try {
    const result = await withButtonState(loginBtn, 'Logging in...', () =>
      loginWithPasskey(serverUrl)
    );

    await saveSetting('serverSessionToken', result.sessionToken);
    await saveSetting('serverSessionExpiry', result.sessionExpiry);
    await saveSetting('serverUsername', result.username);

    updateAuthUI(true, result.username);
    showStatusMessage(statusDiv, 'Logged in successfully!', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleLogout(): Promise<void> {
  const logoutBtn = getElement<HTMLButtonElement>('serverLogoutBtn');
  const statusDiv = getElement('status');

  const settings = await getSettings();

  try {
    await withButtonState(logoutBtn, 'Logging out...', async () => {
      await logout(settings.serverUrl, settings.serverSessionToken);
    });

    await saveSetting('serverSessionToken', '');
    await saveSetting('serverSessionExpiry', '');
    await saveSetting('serverUsername', '');

    updateAuthUI(false, '');
    showStatusMessage(statusDiv, 'Logged out successfully', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
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
    showStatusMessage(statusDiv, 'Please log in first', 'error');
    return;
  }

  try {
    await withButtonState(syncNowBtn, 'Syncing...', async () => {
      if (__IS_WEB__) {
        // For web, import and call sync directly
        const { syncWithServer } = await import('../../lib/server-sync');
        await syncWithServer();
      } else {
        // For extension, send message to service worker
        const response: { success?: boolean; error?: string } | undefined = await chrome.runtime.sendMessage({ type: 'sync:trigger' });
        if (response?.success !== true) {
          throw new Error(response?.error ?? 'Sync failed');
        }
      }
    });

    // Refresh status after sync
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
  // Load initial settings
  void loadSettings();

  // Set up event listeners
  const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
  const saveUrlBtn = getElement<HTMLButtonElement>('serverSaveUrlBtn');
  const registerBtn = getElement<HTMLButtonElement>('serverRegisterBtn');
  const loginBtn = getElement<HTMLButtonElement>('serverLoginBtn');
  const logoutBtn = getElement<HTMLButtonElement>('serverLogoutBtn');
  const syncNowBtn = getElement<HTMLButtonElement>('serverSyncNowBtn');

  enabledCheckbox.addEventListener('change', (e) => void handleEnableToggle(e));
  saveUrlBtn.addEventListener('click', () => void handleUrlSave());
  registerBtn.addEventListener('click', () => void handleRegister());
  loginBtn.addEventListener('click', () => void handleLogin());
  logoutBtn.addEventListener('click', () => void handleLogout());
  syncNowBtn.addEventListener('click', () => void handleSyncNow());

  // Start polling for sync status updates
  startStatusPolling();

  // Cleanup function
  const cleanup = (): void => {
    stopStatusPolling();
  };

  // Ensure cleanup on page unload to prevent memory leaks
  const handleUnload = (): void => {
    cleanup();
  };
  window.addEventListener('beforeunload', handleUnload);

  // Return cleanup function that also removes the unload listener
  return () => {
    window.removeEventListener('beforeunload', handleUnload);
    cleanup();
  };
}
