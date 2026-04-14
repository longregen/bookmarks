import '../shared/app.css';
import {
  deleteJob,
  getBatchJobStats,
  getRecentJobs,
  retryAllFailedBookmarks,
  retryBookmark,
  retryFailedJobItems,
  deleteBookmarkWithData,
  type Job,
} from '../lib/jobs';
import { JobStatus, JobType } from '../db/schema';
import { createElement, getElement } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';
import { createHealthIndicator } from '../ui/health-indicator';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { getPipelineStages, getFailureList, type FailureRow, type PipelineStage } from '../lib/pipeline-stats';

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

const POLL_INTERVAL_MS = 3000;
const ACTIVE_JOB_TYPES = new Set<JobType>([JobType.FILE_IMPORT, JobType.BULK_URL_IMPORT, JobType.SELF_HEAL]);
const RECENT_FINISH_WINDOW_MS = 60_000;

let pollIntervalId: number | null = null;
let autoRefreshEnabled = true;
let refreshPending = false;
let refreshTimer: number | null = null;

let healthCleanup: (() => void) | null = null;
const disposers: (() => void)[] = [];

const pipelineColumns = getElement('pipelineColumns');
const failuresList = getElement('failuresList');
const failuresCount = getElement('failuresCount');
const activeJobsList = getElement('activeJobsList');
const lastUpdatedLabel = getElement('jobsLastUpdated');
const autoRefreshToggle = getElement<HTMLInputElement>('autoRefreshToggle');
const refreshBtn = getElement<HTMLButtonElement>('refreshJobsBtn');
const retryAllBtn = getElement<HTMLButtonElement>('retryAllBtn');

window.addEventListener('beforeunload', () => {
  stopPolling();
  healthCleanup?.();
  for (const d of disposers) d();
});

const healthContainer = document.getElementById('healthIndicator');
if (healthContainer) {
  healthCleanup = createHealthIndicator(healthContainer);
}

autoRefreshToggle.addEventListener('change', () => {
  autoRefreshEnabled = autoRefreshToggle.checked;
  if (autoRefreshEnabled) {
    scheduleRefresh();
    startPolling();
  } else {
    stopPolling();
  }
});

refreshBtn.addEventListener('click', () => scheduleRefresh());
retryAllBtn.addEventListener('click', () => void handleRetryAll());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    scheduleRefresh();
    if (autoRefreshEnabled) startPolling();
  }
});

disposers.push(addBookmarkEventListener((event) => {
  if (event.type.startsWith('bookmark:') || event.type.startsWith('job:')) {
    scheduleRefresh();
  }
}));

function scheduleRefresh(): void {
  if (refreshPending) return;
  refreshPending = true;
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    refreshPending = false;
    void refresh();
  }, 150);
}

function startPolling(): void {
  if (pollIntervalId !== null) return;
  pollIntervalId = window.setInterval(() => scheduleRefresh(), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollIntervalId !== null) {
    window.clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshPending = false;
  }
}

async function refresh(): Promise<void> {
  try {
    const [stages, failures, activeJobs] = await Promise.all([
      getPipelineStages({ recentLimit: 4 }),
      getFailureList(100),
      getActiveJobs(),
    ]);
    renderPipeline(stages);
    renderFailures(failures);
    await renderActiveJobs(activeJobs);
    lastUpdatedLabel.textContent = `Updated ${formatDateByAge(new Date())}`;
  } catch (error) {
    console.error('jobs refresh error', error);
  }
}

function renderPipeline(stages: PipelineStage[]): void {
  pipelineColumns.replaceChildren();
  const grid = document.createDocumentFragment();
  for (const stage of stages) {
    const column = createElement('div', { className: `pipeline-column pipeline-column--${stage.key}` });
    const header = createElement('a', {
      className: 'pipeline-column__header',
      href: `../library/library.html?status=${encodeURIComponent(stage.statuses.join(','))}`,
    });
    header.appendChild(createElement('div', { className: 'pipeline-column__label', textContent: stage.label }));
    header.appendChild(createElement('div', { className: 'pipeline-column__count', textContent: String(stage.count) }));
    column.appendChild(header);
    if (stage.recent.length > 0) {
      const list = createElement('ul', { className: 'pipeline-column__recent' });
      for (const r of stage.recent) {
        list.appendChild(createElement('li', {
          className: 'pipeline-column__item',
          textContent: r.title || r.url,
        }));
      }
      column.appendChild(list);
    }
    grid.appendChild(column);
  }
  pipelineColumns.appendChild(grid);
}

function renderFailures(failures: FailureRow[]): void {
  failuresCount.textContent = `(${failures.length})`;
  failuresList.replaceChildren();
  if (failures.length === 0) {
    failuresList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No failures.' }));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const failure of failures) {
    fragment.appendChild(buildFailureRow(failure));
  }
  failuresList.appendChild(fragment);
}

function buildFailureRow(failure: FailureRow): HTMLElement {
  const row = createElement('div', { className: 'failure-row' });
  const top = createElement('div', { className: 'failure-row__top' });
  top.appendChild(createElement('div', {
    className: 'failure-row__title',
    textContent: failure.title || failure.url,
    title: failure.url,
  }));
  top.appendChild(createElement('div', {
    className: 'failure-row__host',
    textContent: failure.hostname,
  }));
  row.appendChild(top);

  if (failure.errorMessage) {
    row.appendChild(createElement('div', {
      className: 'failure-row__error',
      textContent: `error: ${failure.errorMessage}${failure.retryCount > 0 ? ` (retries: ${failure.retryCount})` : ''}`,
    }));
  }

  const actions = createElement('div', { className: 'failure-row__actions' });
  const retryBtn = createElement('button', { className: 'btn btn-secondary btn-sm', textContent: 'Retry' });
  retryBtn.addEventListener('click', () => void handleRetryOne(failure.id, retryBtn));
  actions.appendChild(retryBtn);

  const viewBtn = createElement('a', {
    className: 'btn btn-secondary btn-sm',
    href: `../view/view.html?id=${encodeURIComponent(failure.id)}`,
    textContent: 'View',
  });
  actions.appendChild(viewBtn);

  const deleteBtn = createElement('button', { className: 'btn btn-danger btn-sm', textContent: 'Delete' });
  deleteBtn.addEventListener('click', () => void handleDeleteOne(failure.id, deleteBtn));
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  return row;
}

async function getActiveJobs(): Promise<Job[]> {
  const recent = await getRecentJobs({ limit: 50 });
  const now = Date.now();
  return recent.filter(job => {
    if (!ACTIVE_JOB_TYPES.has(job.type)) return false;
    if (job.status === JobStatus.PENDING || job.status === JobStatus.IN_PROGRESS) return true;
    if (
      (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED)
      && now - job.createdAt.getTime() < RECENT_FINISH_WINDOW_MS
    ) {
      return true;
    }
    return false;
  });
}

async function renderActiveJobs(jobs: Job[]): Promise<void> {
  activeJobsList.replaceChildren();
  if (jobs.length === 0) {
    activeJobsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No active jobs.' }));
    return;
  }

  const stats = await getBatchJobStats(jobs.map(j => j.id));
  const fragment = document.createDocumentFragment();
  for (const job of jobs) {
    fragment.appendChild(buildActiveJobRow(job, stats.get(job.id)));
  }
  activeJobsList.appendChild(fragment);
}

function formatJobTypeLabel(type: JobType): string {
  switch (type) {
    case JobType.FILE_IMPORT: return 'File Import';
    case JobType.BULK_URL_IMPORT: return 'Bulk URL Import';
    case JobType.SELF_HEAL: return 'Self-Heal';
    case JobType.URL_FETCH: return 'URL Fetch';
    case JobType.SYNC_UPLOAD: return 'Sync Upload';
  }
}

function buildActiveJobRow(job: Job, stats: { total: number; complete: number; error: number; inProgress: number; pending: number } | undefined): HTMLElement {
  const row = createElement('div', { className: `active-job-row active-job-row--${job.status}` });
  const head = createElement('div', { className: 'active-job-row__head' });
  const fileName = job.metadata.fileName ?? '';
  const label = fileName !== '' ? `${formatJobTypeLabel(job.type)} · ${fileName}` : formatJobTypeLabel(job.type);
  head.appendChild(createElement('div', { className: 'active-job-row__label', textContent: label }));
  head.appendChild(createElement('div', { className: 'active-job-row__time', textContent: formatDateByAge(job.createdAt) }));
  row.appendChild(head);

  const total = stats?.total ?? 0;
  const done = (stats?.complete ?? 0) + (stats?.error ?? 0);
  let pct: number;
  if (total > 0) pct = (done / total) * 100;
  else if (job.status === JobStatus.COMPLETED) pct = 100;
  else pct = 0;

  const progressContainer = createElement('div', { className: 'progress-bar-container' });
  progressContainer.appendChild(createElement('div', {
    className: 'progress-bar',
    style: { width: `${Math.min(100, pct)}%` },
  }));
  row.appendChild(progressContainer);

  const metaParts: string[] = [];
  metaParts.push(`${done}/${total || '?'}`);
  if (stats && stats.error > 0) metaParts.push(`${stats.error} errors`);
  metaParts.push(job.status);
  row.appendChild(createElement('div', { className: 'active-job-row__meta', textContent: metaParts.join(' · ') }));

  const actions = createElement('div', { className: 'active-job-row__actions' });
  if (stats && stats.error > 0) {
    const retryBtn = createElement('button', {
      className: 'btn btn-secondary btn-sm',
      textContent: `Retry ${stats.error} failed`,
    });
    retryBtn.addEventListener('click', () => void handleRetryJob(job.id, retryBtn));
    actions.appendChild(retryBtn);
  }
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED || job.status === JobStatus.CANCELLED) {
    const removeBtn = createElement('button', {
      className: 'btn btn-secondary btn-sm',
      textContent: 'Remove',
    });
    removeBtn.addEventListener('click', () => void handleRemoveJob(job.id, removeBtn));
    actions.appendChild(removeBtn);
  }
  if (actions.childElementCount > 0) {
    row.appendChild(actions);
  }
  return row;
}

async function handleRetryOne(bookmarkId: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await retryBookmark(bookmarkId);
    await kickQueue();
    scheduleRefresh();
  } finally {
    btn.disabled = false;
  }
}

async function handleDeleteOne(bookmarkId: string, btn: HTMLButtonElement): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!confirm('Delete this bookmark and its data?')) return;
  btn.disabled = true;
  try {
    await deleteBookmarkWithData(bookmarkId);
    scheduleRefresh();
  } finally {
    btn.disabled = false;
  }
}

async function handleRetryAll(): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!confirm('Retry all failed bookmarks?')) return;
  retryAllBtn.disabled = true;
  try {
    const count = await retryAllFailedBookmarks();
    if (count > 0) await kickQueue();
    scheduleRefresh();
  } finally {
    retryAllBtn.disabled = false;
  }
}

async function handleRetryJob(jobId: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await retryFailedJobItems(jobId);
    await kickQueue();
    scheduleRefresh();
  } finally {
    btn.disabled = false;
  }
}

async function handleRemoveJob(jobId: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    await deleteJob(jobId);
    scheduleRefresh();
  } finally {
    btn.disabled = false;
  }
}

async function kickQueue(): Promise<void> {
  if (__IS_WEB__) return;
  try {
    await chrome.runtime.sendMessage({ type: 'bookmark:retry', data: { trigger: 'user_manual' } });
  } catch { /* service worker may not be running */ }
}

// Initial load + polling
scheduleRefresh();
startPolling();
