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
import { enterTier, getMarkdownCacheStats, planTierTransition, type TierTransitionPlan } from '../../lib/content-tier';
import type { ContentTier } from '../../lib/platform';

const SYNC_POLL_INTERVAL = 2000;

let statusPoller: Poller | null = null;

function showSetupSection(): void {
  getElement('serverSetupSection').classList.remove('hidden');
  getElement('serverConnectedSection').classList.add('hidden');
}

function showConnectedSection(serverUrl: string, authToken: string): void {
  getElement('serverSetupSection').classList.add('hidden');
  getElement('serverConnectedSection').classList.remove('hidden');

  getElement<HTMLInputElement>('serverUrlDisplay').value = serverUrl;
  getElement<HTMLInputElement>('serverTokenDisplay').value = authToken;
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

function updateCheckButtonState(): void {
  const urlInput = getElement<HTMLInputElement>('serverUrl');
  const checkBtn = getElement<HTMLButtonElement>('serverCheckBtn');
  checkBtn.disabled = !urlInput.value.trim();
}

function updateConnectButtonState(): void {
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const connectBtn = getElement<HTMLButtonElement>('serverConnectBtn');
  const hasToken = tokenInput.value.trim().length > 0;
  connectBtn.disabled = !hasToken;
  if (hasToken) {
    connectBtn.classList.add('sync-connect-highlight');
  } else {
    connectBtn.classList.remove('sync-connect-highlight');
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

  if (isLoggedIn) {
    showConnectedSection(settings.serverUrl, settings.serverAuthToken);
    updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);
  } else {
    showSetupSection();
    updateCheckButtonState();
  }
}

async function handleEnableToggle(event: Event): Promise<void> {
  const checkbox = event.target as HTMLInputElement;
  const enabled = checkbox.checked;

  await saveSetting('serverEnabled', enabled);
  updateFieldsVisibility(enabled);
  await notifySyncSettingsChanged();
}

async function handleCheckServer(): Promise<void> {
  const urlInput = getElement<HTMLInputElement>('serverUrl');
  const checkBtn = getElement<HTMLButtonElement>('serverCheckBtn');
  const checkStatus = getElement('serverCheckStatus');
  const authSection = getElement('serverAuthSection');

  const url = urlInput.value.trim();

  if (!url) return;

  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    checkStatus.textContent = 'URL must start with http:// or https://';
    checkStatus.className = 'server-check-status error';
    checkStatus.classList.remove('hidden');
    authSection.classList.add('hidden');
    return;
  }

  try {
    await withButtonState(checkBtn, 'Checking...', async () => {
      const client = new ServerApiClient(url, '');
      await client.checkHealth();
    });

    checkStatus.textContent = 'Server is reachable';
    checkStatus.className = 'server-check-status success';
    checkStatus.classList.remove('hidden');

    authSection.classList.remove('hidden');
    updateConnectButtonState();
  } catch (error) {
    checkStatus.textContent = `Cannot reach server: ${getErrorMessage(error)}`;
    checkStatus.className = 'server-check-status error';
    checkStatus.classList.remove('hidden');
    authSection.classList.add('hidden');
  }
}

function handleGenerateToken(): void {
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const copyBtn = getElement<HTMLButtonElement>('serverCopyTokenBtn');
  const warning = getElement('serverTokenWarning');

  tokenInput.value = generateToken();
  copyBtn.classList.remove('hidden');
  warning.classList.remove('hidden');
  updateConnectButtonState();
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

    showConnectedSection(serverUrl, token);

    const settings = await getSettings();
    updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);

    // Clear setup form
    tokenInput.value = '';
    getElement<HTMLButtonElement>('serverCopyTokenBtn').classList.add('hidden');
    getElement('serverTokenWarning').classList.add('hidden');
    getElement('serverAuthSection').classList.add('hidden');
    getElement('serverCheckStatus').classList.add('hidden');

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

    await notifySyncSettingsChanged();

    const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
    enabledCheckbox.checked = false;

    showSetupSection();
    showStatusMessage(statusDiv, 'Disconnected successfully', 'success');
  } catch (error) {
    showStatusMessage(statusDiv, getErrorMessage(error), 'error', 5000);
  }
}

async function handleDeleteAccount(): Promise<void> {
  const deleteBtn = getElement<HTMLButtonElement>('serverDeleteAccountBtn');
  const statusDiv = getElement('status');

  // eslint-disable-next-line no-alert
  if (!confirm('Are you sure you want to delete all server data? This action cannot be undone.\n\nYou will be disconnected after deletion.')) {
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

    showSetupSection();
    showStatusMessage(statusDiv, 'All server data deleted and disconnected', 'success');
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

async function pollSyncStatus(): Promise<void> {
  const settings = await getSettings();
  updateSyncStatus(settings.serverLastSyncTime, settings.serverLastSyncError);
  await refreshCacheUsage();
}

let pendingTierPlan: TierTransitionPlan | null = null;

async function loadTierSettings(): Promise<void> {
  const settings = await getSettings();
  const select = getElement<HTMLSelectElement>('contentTierSelect');
  select.value = settings.contentTier;
  const capInput = getElement<HTMLInputElement>('markdownCacheCapInput');
  capInput.value = String(settings.markdownCacheCapMB);
  updateCacheRowVisibility(settings.contentTier);
  await refreshCacheUsage();
}

function updateCacheRowVisibility(tier: ContentTier): void {
  const row = getElement('markdownCacheRow');
  row.classList.toggle('hidden', tier === 'full' || tier === 'titles');
}

async function refreshCacheUsage(): Promise<void> {
  const usage = getElement('markdownCacheUsage');
  try {
    const stats = await getMarkdownCacheStats();
    const usedMB = (stats.bytes / 1024 / 1024).toFixed(1);
    const capMB = (stats.capBytes / 1024 / 1024).toFixed(0);
    const lastEvict = stats.lastEviction
      ? ` · last evicted ${formatDateByAge(new Date(stats.lastEviction.at))} (${stats.lastEviction.rowsFreed} rows)`
      : '';
    usage.textContent = `Using ${usedMB} MB of ${capMB} MB · ${stats.rowCount} rows${lastEvict}`;
  } catch {
    usage.textContent = '';
  }
}

function describePlan(plan: TierTransitionPlan): string {
  if (plan.from === plan.to) return 'No change.';
  if (plan.blockedByPendingQueue) {
    return 'Sync queue has pending changes. Run a sync before changing tiers.';
  }
  const parts: string[] = [];
  if (plan.markdownRowsToDelete > 0) {
    const mb = (plan.markdownBytesToDelete / 1024 / 1024).toFixed(1);
    parts.push(`${plan.markdownRowsToDelete} markdown documents (~${mb} MB)`);
  }
  if (plan.qaRowsToDelete > 0) parts.push(`${plan.qaRowsToDelete} Q&A rows`);
  if (plan.summaryRowsToDelete > 0) parts.push(`${plan.summaryRowsToDelete} summaries`);

  const tierLabel = (t: ContentTier): string => {
    if (t === 'full') return 'Full';
    if (t === 'summaries') return 'Summaries';
    return 'Titles only';
  };

  if (parts.length === 0) return `Switching to ${tierLabel(plan.to)}.`;
  const preserveNote = plan.embeddingsPreserved > 0
    ? ` Embeddings preserved for ${plan.embeddingsPreserved} rows.`
    : '';
  return `Switching to ${tierLabel(plan.to)} will remove ${parts.join(', ')} from this device.${preserveNote} Content stays on your sync server and is fetched on demand.`;
}

async function handleTierSelectChange(): Promise<void> {
  const select = getElement<HTMLSelectElement>('contentTierSelect');
  const confirmPanel = getElement('tierConfirmPanel');
  const confirmSummary = getElement('tierConfirmSummary');
  const target = select.value as ContentTier;

  const plan = await planTierTransition(target);
  pendingTierPlan = plan;

  if (plan.from === plan.to) {
    confirmPanel.classList.add('hidden');
    updateCacheRowVisibility(target);
    return;
  }

  const isUpgrade = tierRank(plan.to) < tierRank(plan.from);
  if (isUpgrade) {
    confirmPanel.classList.add('hidden');
    await applyTierChange();
    return;
  }

  confirmSummary.textContent = describePlan(plan);
  getElement<HTMLButtonElement>('tierConfirmBtn').disabled = plan.blockedByPendingQueue;
  confirmPanel.classList.remove('hidden');
}

function tierRank(t: ContentTier): number {
  if (t === 'full') return 0;
  if (t === 'summaries') return 1;
  return 2;
}

async function applyTierChange(): Promise<void> {
  if (!pendingTierPlan) return;
  const target = pendingTierPlan.to;
  const confirmPanel = getElement('tierConfirmPanel');
  const progress = getElement('tierProgress');
  const progressBar = getElement('tierProgressBar');
  const progressStatus = getElement('tierProgressStatus');
  const statusDiv = getElement('status');

  confirmPanel.classList.add('hidden');
  progress.classList.remove('hidden');
  progressStatus.textContent = 'Applying…';

  try {
    await enterTier(target, {
      onProgress: (pct) => {
        progressBar.style.width = `${pct}%`;
      },
    });
    await notifySyncSettingsChanged();
    showStatusMessage(statusDiv, `Storage mode set to ${target}.`, 'success');
    updateCacheRowVisibility(target);
    await refreshCacheUsage();
  } catch (error) {
    showStatusMessage(statusDiv, `Failed to change tier: ${getErrorMessage(error)}`, 'error', 5000);
    const select = getElement<HTMLSelectElement>('contentTierSelect');
    const settings = await getSettings();
    select.value = settings.contentTier;
  } finally {
    progress.classList.add('hidden');
    progressBar.style.width = '0%';
    pendingTierPlan = null;
  }
}

async function cancelTierChange(): Promise<void> {
  const confirmPanel = getElement('tierConfirmPanel');
  confirmPanel.classList.add('hidden');
  pendingTierPlan = null;
  const settings = await getSettings();
  getElement<HTMLSelectElement>('contentTierSelect').value = settings.contentTier;
}

async function handleCacheCapInput(): Promise<void> {
  const input = getElement<HTMLInputElement>('markdownCacheCapInput');
  const raw = Number(input.value);
  const mb = Number.isFinite(raw) ? Math.max(5, Math.min(5000, Math.round(raw))) : 50;
  if (mb !== raw) input.value = String(mb);
  await saveSetting('markdownCacheCapMB', mb);
  try {
    const { maybeEvictMarkdownLRU } = await import('../../lib/content-tier');
    await maybeEvictMarkdownLRU();
  } catch {
    // best-effort
  }
  await refreshCacheUsage();
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
  void loadTierSettings();

  const enabledCheckbox = getElement<HTMLInputElement>('serverEnabled');
  const checkBtn = getElement<HTMLButtonElement>('serverCheckBtn');
  const urlInput = getElement<HTMLInputElement>('serverUrl');
  const generateTokenBtn = getElement<HTMLButtonElement>('serverGenerateTokenBtn');
  const copyTokenBtn = getElement<HTMLButtonElement>('serverCopyTokenBtn');
  const tokenInput = getElement<HTMLInputElement>('serverToken');
  const connectBtn = getElement<HTMLButtonElement>('serverConnectBtn');
  const logoutBtn = getElement<HTMLButtonElement>('serverLogoutBtn');
  const deleteAccountBtn = getElement<HTMLButtonElement>('serverDeleteAccountBtn');
  const syncNowBtn = getElement<HTMLButtonElement>('serverSyncNowBtn');
  const tierSelect = getElement<HTMLSelectElement>('contentTierSelect');
  const cacheCapInput = getElement<HTMLInputElement>('markdownCacheCapInput');
  const tierConfirmBtn = getElement<HTMLButtonElement>('tierConfirmBtn');
  const tierCancelBtn = getElement<HTMLButtonElement>('tierCancelBtn');

  enabledCheckbox.addEventListener('change', (e) => void handleEnableToggle(e));
  checkBtn.addEventListener('click', () => void handleCheckServer());
  urlInput.addEventListener('input', () => updateCheckButtonState());
  generateTokenBtn.addEventListener('click', () => handleGenerateToken());
  copyTokenBtn.addEventListener('click', () => void handleCopyToken());
  tokenInput.addEventListener('input', () => updateConnectButtonState());
  connectBtn.addEventListener('click', () => void handleConnect());
  logoutBtn.addEventListener('click', () => void handleLogout());
  deleteAccountBtn.addEventListener('click', () => void handleDeleteAccount());
  syncNowBtn.addEventListener('click', () => void handleSyncNow());
  tierSelect.addEventListener('change', () => void handleTierSelectChange());
  cacheCapInput.addEventListener('change', () => void handleCacheCapInput());
  tierConfirmBtn.addEventListener('click', () => void applyTierChange());
  tierCancelBtn.addEventListener('click', () => void cancelTierChange());

  startStatusPolling();

  return () => {
    stopStatusPolling();
  };
}
