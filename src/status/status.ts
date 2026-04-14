import '../shared/app.css';
import { createElement, getElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';
import { createHealthIndicator } from '../ui/health-indicator';
import { createSyncStatusIndicator, deriveSyncPresentation, getSyncStatus } from '../ui/sync-status-indicator';
import { formatDateByAge } from '../lib/date-format';
import { serverSync } from '../lib/server-sync';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { getPipelineStages, type PipelineStage } from '../lib/pipeline-stats';
import { retryAllFailedBookmarks } from '../lib/jobs';
import { getStorageBreakdown, formatBytes } from '../db/storage-breakdown';
import { initSyncActivityLog, getRecentSyncActivity, type SyncActivityEntry } from '../lib/sync-activity-log';
import { getMarkdownCacheStats } from '../lib/content-tier';
import { getSettings } from '../lib/settings';
import { getErrorMessage } from '../lib/errors';

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

const disposeActivityLog = initSyncActivityLog();

let healthCleanup: (() => void) | null = null;
let syncCleanup: (() => void) | null = null;
const eventDisposers: (() => void)[] = [];
const intervals: number[] = [];

window.addEventListener('beforeunload', () => {
  healthCleanup?.();
  syncCleanup?.();
  disposeActivityLog();
  for (const d of eventDisposers) d();
  for (const id of intervals) clearInterval(id);
});

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  healthCleanup = createHealthIndicator(healthIndicatorContainer);
}
const syncIndicatorContainer = document.getElementById('syncIndicator');
if (syncIndicatorContainer) {
  syncCleanup = createSyncStatusIndicator(syncIndicatorContainer, 'compact');
}

// ----- Sync State card -----

async function renderSyncState(): Promise<void> {
  const body = getElement('syncStateBody');
  try {
    const state = await getSyncStatus();
    const presentation = deriveSyncPresentation(state);
    body.replaceChildren();

    const badge = createElement('div', { className: `sync-state-badge ${presentation.className}` });
    badge.appendChild(createElement('span', { className: 'sync-state-badge__icon', textContent: presentation.symbol }));
    badge.appendChild(createElement('span', { className: 'sync-state-badge__text', textContent: presentation.text }));
    body.appendChild(badge);

    const settings = await getSettings();
    const list = createElement('dl', { className: 'dashboard-kv' });
    appendKv(list, 'Server', settings.serverUrl || '—');
    appendKv(list, 'Logged in', state.isLoggedIn ? 'Yes' : 'No');
    if (state.lastSyncTime !== null && state.lastSyncTime !== '') {
      appendKv(list, 'Last sync', `${formatDateByAge(new Date(state.lastSyncTime))} (${new Date(state.lastSyncTime).toLocaleString()})`);
    } else {
      appendKv(list, 'Last sync', 'Never');
    }
    if (state.lastSyncError !== null && state.lastSyncError !== '') appendKv(list, 'Last error', state.lastSyncError);
    appendKv(list, 'In progress', state.isSyncing ? 'Yes' : 'No');
    body.appendChild(list);
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

// ----- Offline Queue card -----

async function renderOfflineQueue(): Promise<void> {
  const body = getElement('offlineQueueBody');
  try {
    const summary = await serverSync.getOfflineQueueSummary();
    body.replaceChildren();
    if (summary.total === 0) {
      body.appendChild(createElement('div', { className: 'empty-state', textContent: 'Queue is empty.' }));
      return;
    }

    const totalLine = createElement('div', { className: 'dashboard-metric' });
    totalLine.appendChild(createElement('div', { className: 'dashboard-metric__value', textContent: String(summary.total) }));
    totalLine.appendChild(createElement('div', { className: 'dashboard-metric__label', textContent: 'pending changes' }));
    body.appendChild(totalLine);

    const list = createElement('dl', { className: 'dashboard-kv' });
    appendKv(list, 'Create', String(summary.byType.create));
    appendKv(list, 'Update', String(summary.byType.update));
    appendKv(list, 'Delete', String(summary.byType.delete));
    if (summary.oldestTimestamp !== null) {
      appendKv(list, 'Oldest', formatDateByAge(new Date(summary.oldestTimestamp)));
    }
    body.appendChild(list);

    if (summary.recent.length > 0) {
      const details = createElement('details', { className: 'dashboard-details' });
      const summaryEl = createElement('summary', { textContent: `Oldest ${summary.recent.length} items` });
      details.appendChild(summaryEl);
      const ul = createElement('ul', { className: 'dashboard-list' });
      for (const r of summary.recent) {
        const li = createElement('li', {
          textContent: `${r.type} · ${r.bookmarkId.slice(0, 8)}… · ${formatDateByAge(new Date(r.timestamp))}`,
        });
        ul.appendChild(li);
      }
      details.appendChild(ul);
      body.appendChild(details);
    }
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

// ----- Pipeline card -----

async function renderPipeline(): Promise<void> {
  const body = getElement('pipelineBody');
  try {
    const stages = await getPipelineStages({ recentLimit: 3 });
    body.replaceChildren();
    const grid = createElement('div', { className: 'pipeline-grid' });
    for (const stage of stages) {
      grid.appendChild(buildStageColumn(stage));
    }
    body.appendChild(grid);
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

function buildStageColumn(stage: PipelineStage): HTMLElement {
  const col = createElement('div', { className: `pipeline-column pipeline-column--${stage.key}` });
  const header = createElement('a', {
    className: 'pipeline-column__header',
    href: `../library/library.html?status=${encodeURIComponent(stage.statuses.join(','))}`,
  });
  header.appendChild(createElement('div', { className: 'pipeline-column__label', textContent: stage.label }));
  header.appendChild(createElement('div', { className: 'pipeline-column__count', textContent: String(stage.count) }));
  col.appendChild(header);
  if (stage.recent.length > 0) {
    const list = createElement('ul', { className: 'pipeline-column__recent' });
    for (const b of stage.recent) {
      list.appendChild(createElement('li', {
        className: 'pipeline-column__item',
        textContent: b.title || b.url,
      }));
    }
    col.appendChild(list);
  }
  return col;
}

// ----- Recent Sync Activity card -----

async function renderActivity(): Promise<void> {
  const body = getElement('activityBody');
  try {
    const entries = await getRecentSyncActivity(20);
    body.replaceChildren();
    if (entries.length === 0) {
      body.appendChild(createElement('div', { className: 'empty-state', textContent: 'No sync activity recorded yet.' }));
      return;
    }
    const list = createElement('ul', { className: 'dashboard-list' });
    for (const e of entries) {
      list.appendChild(buildActivityRow(e));
    }
    body.appendChild(list);
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

function buildActivityRow(entry: SyncActivityEntry): HTMLElement {
  const li = createElement('li', { className: `activity-row activity-row--${entry.kind}` });
  const when = formatDateByAge(new Date(entry.timestamp));
  let label: string;
  if (entry.kind === 'started') label = 'Sync started';
  else if (entry.kind === 'failed') label = `Sync failed — ${entry.error ?? ''}`;
  else label = `Sync ${entry.action ?? 'completed'}${typeof entry.count === 'number' ? ` (${entry.count})` : ''}`;
  li.appendChild(createElement('span', { className: 'activity-row__label', textContent: label }));
  li.appendChild(createElement('span', { className: 'activity-row__when', textContent: when }));
  return li;
}

// ----- Storage Tiers card -----

async function renderTiers(): Promise<void> {
  const body = getElement('tiersBody');
  try {
    const [settings, cacheStats] = await Promise.all([getSettings(), getMarkdownCacheStats()]);
    body.replaceChildren();
    const tierPill = createElement('div', {
      className: `tier-pill tier-pill--${settings.contentTier}`,
      textContent: `Tier: ${settings.contentTier}`,
    });
    body.appendChild(tierPill);

    const pctRaw = cacheStats.capBytes > 0 ? (cacheStats.bytes / cacheStats.capBytes) * 100 : 0;
    const pct = Math.min(100, Math.max(0, pctRaw));
    const bar = createElement('div', { className: 'progress-bar-container' });
    bar.appendChild(createElement('div', { className: 'progress-bar', style: { width: `${pct}%` } }));
    body.appendChild(bar);

    const list = createElement('dl', { className: 'dashboard-kv' });
    appendKv(list, 'Markdown cache', `${formatBytes(cacheStats.bytes)} / ${formatBytes(cacheStats.capBytes)} (${pct.toFixed(1)}%)`);
    appendKv(list, 'Cached markdown rows', String(cacheStats.rowCount));
    if (cacheStats.lastEviction) {
      appendKv(list, 'Last eviction', `${formatDateByAge(new Date(cacheStats.lastEviction.at))} — ${cacheStats.lastEviction.rowsFreed} rows freed`);
    }
    body.appendChild(list);
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

// ----- Content Inventory card -----

async function renderInventory(force = false): Promise<void> {
  const body = getElement('inventoryBody');
  try {
    const breakdown = await getStorageBreakdown({ force });
    body.replaceChildren();

    if (breakdown.browserQuota) {
      const { usage, quota } = breakdown.browserQuota;
      const pct = quota > 0 ? (usage / quota) * 100 : 0;
      const bar = createElement('div', { className: 'progress-bar-container' });
      bar.appendChild(createElement('div', { className: 'progress-bar', style: { width: `${Math.min(100, pct)}%` } }));
      body.appendChild(bar);
      body.appendChild(createElement('div', {
        className: 'dashboard-metric__label',
        textContent: `${formatBytes(usage)} of ${formatBytes(quota)} browser quota (${pct.toFixed(1)}%)`,
      }));
    }

    const table = createElement('table', { className: 'dashboard-table' });
    const thead = createElement('thead');
    const headerRow = createElement('tr');
    for (const h of ['Table', 'Rows', 'Est. bytes']) {
      headerRow.appendChild(createElement('th', { textContent: h }));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = createElement('tbody');
    for (const t of breakdown.perTable) {
      const row = createElement('tr');
      row.appendChild(createElement('td', { textContent: t.name }));
      row.appendChild(createElement('td', { textContent: String(t.rows) }));
      row.appendChild(createElement('td', { textContent: formatBytes(t.estBytes) }));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    const legacy = breakdown.legacy;
    const kv = createElement('dl', { className: 'dashboard-kv' });
    appendKv(kv, 'Total bookmarks', String(legacy.totalBookmarks));
    appendKv(kv, 'With markdown', String(legacy.withMarkdown));
    appendKv(kv, 'With Q&A', String(legacy.withQa));
    appendKv(kv, 'Total Q&A pairs', String(legacy.totalQaPairs));
    appendKv(kv, 'With summary', String(legacy.withSummary));
    body.appendChild(kv);
  } catch (error) {
    body.textContent = `Error: ${getErrorMessage(error)}`;
  }
}

// ----- Helpers + wiring -----

function appendKv(list: HTMLElement, label: string, value: string): void {
  list.appendChild(createElement('dt', { textContent: label }));
  list.appendChild(createElement('dd', { textContent: value }));
}

async function triggerSyncNow(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    if (__IS_WEB__) {
      await serverSync.incrementalSync();
    } else {
      await chrome.runtime.sendMessage({ type: 'sync:trigger' });
    }
    await renderSyncState();
    await renderOfflineQueue();
    await renderActivity();
  } catch (error) {
    console.error(error);
  } finally {
    btn.disabled = false;
  }
}

async function retryQueue(btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await serverSync.processOfflineQueue();
    await renderOfflineQueue();
  } finally {
    btn.disabled = false;
  }
}

async function clearQueue(btn: HTMLButtonElement): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!confirm('Discard all pending offline changes? This cannot be undone.')) return;
  btn.disabled = true;
  try {
    await serverSync.clearOfflineQueue();
    await renderOfflineQueue();
  } finally {
    btn.disabled = false;
  }
}

async function retryAll(btn: HTMLButtonElement): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!confirm('Retry all failed bookmarks?')) return;
  btn.disabled = true;
  try {
    const count = await retryAllFailedBookmarks();
    if (!__IS_WEB__ && count > 0) {
      try {
        await chrome.runtime.sendMessage({ type: 'bookmark:retry', data: { trigger: 'user_manual' } });
      } catch { /* ignore */ }
    }
    await renderPipeline();
  } finally {
    btn.disabled = false;
  }
}

getElement<HTMLButtonElement>('syncNowBtn').addEventListener('click', (e) => {
  void triggerSyncNow(e.currentTarget as HTMLButtonElement);
});
getElement<HTMLButtonElement>('queueRetryBtn').addEventListener('click', (e) => {
  void retryQueue(e.currentTarget as HTMLButtonElement);
});
getElement<HTMLButtonElement>('queueClearBtn').addEventListener('click', (e) => {
  void clearQueue(e.currentTarget as HTMLButtonElement);
});
getElement<HTMLButtonElement>('retryAllBtn').addEventListener('click', (e) => {
  void retryAll(e.currentTarget as HTMLButtonElement);
});
getElement<HTMLButtonElement>('inventoryRefreshBtn').addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  void renderInventory(true).finally(() => { btn.disabled = false; });
});

// Polling cadences
intervals.push(window.setInterval(() => {
  void renderSyncState();
  void renderOfflineQueue();
  void renderPipeline();
}, 2000));
intervals.push(window.setInterval(() => {
  void renderTiers();
  void renderInventory();
}, 30000));

// Event-driven refresh
eventDisposers.push(addBookmarkEventListener((event) => {
  if (event.type.startsWith('sync:')) {
    void renderSyncState();
    void renderActivity();
    void renderOfflineQueue();
  } else if (event.type.startsWith('bookmark:') || event.type.startsWith('job:')) {
    void renderPipeline();
  } else if (event.type.startsWith('tier:')) {
    void renderTiers();
  }
}));

// Initial load
void renderSyncState();
void renderOfflineQueue();
void renderPipeline();
void renderActivity();
void renderTiers();
void renderInventory();
