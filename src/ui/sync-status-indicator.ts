import { createElement } from './dom';
import { getSettings } from '../lib/settings';
import { formatDateByAge } from '../lib/date-format';
import { createPoller, type Poller } from '../lib/polling-manager';
import { serverSync } from '../lib/server-sync';

export interface SyncStatusState {
  isEnabled: boolean;
  isLoggedIn: boolean;
  lastSyncTime: string | null;
  lastSyncError: string | null;
  isSyncing: boolean;
  pendingChanges: number;
}

export type SyncIndicatorStyle = 'full' | 'compact';

const POLL_INTERVAL = 5000;

export async function getSyncStatus(): Promise<SyncStatusState> {
  const settings = await getSettings();
  const syncStatus = await serverSync.getSyncStatus();

  const isEnabled = settings.serverEnabled;
  const isLoggedIn = Boolean(settings.serverSessionToken);
  const lastSyncTime = settings.serverLastSyncTime || null;
  const lastSyncError = settings.serverLastSyncError || null;

  return {
    isEnabled,
    isLoggedIn,
    lastSyncTime,
    lastSyncError,
    isSyncing: syncStatus.isSyncing,
    pendingChanges: syncStatus.pendingChanges,
  };
}

export function deriveSyncPresentation(state: SyncStatusState): {
  symbol: string;
  className: string;
  text: string;
} {
  const { symbol, className } = getStatusIcon(state);
  return { symbol, className, text: getStatusText(state) };
}

function getStatusIcon(state: SyncStatusState): { symbol: string; className: string } {
  if (!state.isEnabled) {
    return { symbol: '○', className: 'sync-indicator--disabled' };
  }
  if (!state.isLoggedIn) {
    return { symbol: '○', className: 'sync-indicator--disconnected' };
  }
  if (state.lastSyncError !== null && state.lastSyncError !== '') {
    return { symbol: '!', className: 'sync-indicator--error' };
  }
  if (state.isSyncing) {
    return { symbol: '↻', className: 'sync-indicator--syncing' };
  }
  if (state.pendingChanges > 0) {
    return { symbol: '↑', className: 'sync-indicator--pending' };
  }
  if (state.lastSyncTime !== null && state.lastSyncTime !== '') {
    return { symbol: '✓', className: 'sync-indicator--synced' };
  }
  return { symbol: '○', className: 'sync-indicator--idle' };
}

function getStatusText(state: SyncStatusState): string {
  if (!state.isEnabled) {
    return 'Sync disabled';
  }
  if (!state.isLoggedIn) {
    return 'Not logged in';
  }
  if (state.lastSyncError !== null && state.lastSyncError !== '') {
    return `Error: ${state.lastSyncError}`;
  }
  if (state.isSyncing) {
    return 'Syncing...';
  }
  if (state.pendingChanges > 0) {
    return `${state.pendingChanges} pending`;
  }
  if (state.lastSyncTime !== null && state.lastSyncTime !== '') {
    const date = new Date(state.lastSyncTime);
    return `Synced ${formatDateByAge(date)}`;
  }
  return 'Not synced yet';
}

export function createSyncStatusIndicator(
  container: HTMLElement,
  style: SyncIndicatorStyle = 'compact'
): () => void {
  const wrapper = createElement('div', { className: `sync-indicator sync-indicator--${style}` });

  const icon = createElement('span', { className: 'sync-indicator__icon' });
  const text = createElement('span', { className: 'sync-indicator__text' });

  wrapper.appendChild(icon);
  if (style === 'full') {
    wrapper.appendChild(text);
  }

  container.appendChild(wrapper);

  // Tooltip for compact mode
  let tooltip: HTMLElement | null = null;
  if (style === 'compact') {
    tooltip = createElement('div', { className: 'sync-indicator__tooltip' });
    container.style.position = 'relative';
    container.appendChild(tooltip);

    wrapper.addEventListener('mouseenter', () => {
      if (tooltip) tooltip.style.opacity = '1';
    });

    wrapper.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.opacity = '0';
    });
  }

  async function update(): Promise<void> {
    const state = await getSyncStatus();
    const { symbol, className } = getStatusIcon(state);
    const statusText = getStatusText(state);

    icon.textContent = symbol;
    wrapper.className = `sync-indicator sync-indicator--${style} ${className}`;
    text.textContent = statusText;

    if (tooltip) {
      tooltip.textContent = statusText;
    }
  }

  void update();

  const poller: Poller = createPoller(update, POLL_INTERVAL, { immediate: false });
  poller.start();

  return () => {
    poller.stop();
    container.removeChild(wrapper);
    if (tooltip) {
      container.removeChild(tooltip);
    }
  };
}
