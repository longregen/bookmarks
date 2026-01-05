import {
  getRecentJobs,
  deleteJob,
  getBatchJobStats,
  getBatchJobItems,
  retryFailedJobItems,
  type Job,
  type JobItem,
  type JobStats,
  JobItemStatus,
} from '../lib/jobs';
import { db, JobType, JobStatus, type Bookmark } from '../db/schema';
import { createElement } from '../ui/dom';
import { formatTimeAgo } from '../lib/time';

const jobTypeFilter = document.getElementById('jobTypeFilter') as HTMLSelectElement;
const jobStatusFilter = document.getElementById('jobStatusFilter') as HTMLSelectElement;
const refreshJobsBtn = document.getElementById('refreshJobsBtn') as HTMLButtonElement;
const jobsList = document.getElementById('jobsList') as HTMLDivElement;

// Cache for expanded jobs
const expandedJobs = new Set<string>();

// Store interval ID for cleanup
let refreshIntervalId: number | undefined;

interface PreloadedJobData {
  stats: Map<string, JobStats>;
  jobItems: Map<string, JobItem[]>;
  bookmarks: Map<string, Bookmark | undefined>;
}

async function loadJobs(): Promise<void> {
  try {
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'loading', textContent: 'Loading jobs...' }));

    const jobs = await getRecentJobs({ limit: 100 });

    const typeFilter = jobTypeFilter.value;
    const statusFilter = jobStatusFilter.value;

    let filteredJobs = jobs;

    if (typeFilter) {
      filteredJobs = filteredJobs.filter(job => job.type === typeFilter as JobType);
    }

    if (statusFilter) {
      filteredJobs = filteredJobs.filter(job => job.status === statusFilter as JobStatus);
    }

    if (filteredJobs.length === 0) {
      jobsList.textContent = '';
      jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'No jobs found' }));
      return;
    }

    // Batch load all job stats and items to avoid N+1 queries
    const jobIds = filteredJobs.map(job => job.id);
    const [statsMap, jobItemsMap] = await Promise.all([
      getBatchJobStats(jobIds),
      getBatchJobItems(jobIds)
    ]);

    // Collect all bookmark IDs from job items that need bookmarks loaded
    const allBookmarkIds = new Set<string>();
    for (const job of filteredJobs) {
      if (job.type === JobType.BULK_URL_IMPORT) {
        const items = jobItemsMap.get(job.id) ?? [];
        for (const item of items) {
          allBookmarkIds.add(item.bookmarkId);
        }
      }
    }

    // Batch load all bookmarks
    const bookmarkIds = Array.from(allBookmarkIds);
    const bookmarksArray = bookmarkIds.length > 0
      ? await db.bookmarks.bulkGet(bookmarkIds)
      : [];
    const bookmarksMap = new Map<string, Bookmark | undefined>();
    bookmarkIds.forEach((id, idx) => {
      bookmarksMap.set(id, bookmarksArray[idx]);
    });

    const preloadedData: PreloadedJobData = {
      stats: statsMap,
      jobItems: jobItemsMap,
      bookmarks: bookmarksMap
    };

    jobsList.textContent = '';
    for (const job of filteredJobs) {
      const jobEl = renderJobItemElement(job, preloadedData);
      jobsList.appendChild(jobEl);
    }
  } catch (error) {
    console.error('Error loading jobs:', error);
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'Error loading jobs' }));
  }
}

function renderJobItemElement(job: Job, data: PreloadedJobData): HTMLElement {
  const typeLabel = formatJobType(job.type);
  const statusClass = job.status.toLowerCase();
  const statusLabel = job.status.replace('_', ' ').toUpperCase();
  const timestamp = formatTimeAgo(job.createdAt);

  const jobItem = createElement('div', {
    className: `job-item ${expandedJobs.has(job.id) ? 'expanded' : ''}`,
    attributes: { 'data-job-id': job.id }
  });

  const header = createElement('div', { className: 'job-header' });
  const jobInfo = createElement('div', { className: 'job-info' });
  jobInfo.appendChild(createElement('div', { className: 'job-type', textContent: typeLabel }));
  jobInfo.appendChild(createElement('div', { className: 'job-timestamp', textContent: timestamp }));
  header.appendChild(jobInfo);
  header.appendChild(createElement('div', { className: `job-status-badge ${statusClass}`, textContent: statusLabel }));

  // Add click handler to toggle expansion
  header.style.cursor = 'pointer';
  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.job-actions')) return;
    if (expandedJobs.has(job.id)) {
      expandedJobs.delete(job.id);
    } else {
      expandedJobs.add(job.id);
    }
    void loadJobs();
  });

  jobItem.appendChild(header);

  // Get job stats from preloaded data
  const stats = data.stats.get(job.id) ?? { total: 0, pending: 0, inProgress: 0, complete: 0, error: 0 };
  const jobItems = data.jobItems.get(job.id) ?? [];

  // Show progress bar and stats for bulk imports
  if (job.type === JobType.BULK_URL_IMPORT && stats.total > 0) {
    let downloadedCount = 0;
    let fetchingCount = 0;
    let processingCount = 0;

    // Use preloaded bookmarks data
    for (const item of jobItems) {
      const bookmark = data.bookmarks.get(item.bookmarkId);
      if (bookmark?.status === 'downloaded') downloadedCount++;
      else if (bookmark?.status === 'fetching') fetchingCount++;
      else if (bookmark?.status === 'processing') processingCount++;
    }

    const progressContainer = createElement('div', { className: 'job-progress-container' });

    // Progress bar with multiple segments
    const progressBar = createElement('div', { className: 'job-progress-bar' });
    const completedPercent = Math.round((stats.complete / stats.total) * 100);
    const errorPercent = Math.round((stats.error / stats.total) * 100);
    const downloadedPercent = Math.round((downloadedCount / stats.total) * 100);

    const completedFill = createElement('div', {
      className: 'job-progress-fill completed',
      style: { width: `${completedPercent}%` }
    });
    const downloadedFill = createElement('div', {
      className: 'job-progress-fill downloaded',
      style: { width: `${downloadedPercent}%` }
    });
    const errorFill = createElement('div', {
      className: 'job-progress-fill error',
      style: { width: `${errorPercent}%` }
    });

    progressBar.appendChild(completedFill);
    progressBar.appendChild(downloadedFill);
    progressBar.appendChild(errorFill);
    progressContainer.appendChild(progressBar);

    // Stats summary with granular breakdown
    const statsDiv = createElement('div', { className: 'job-stats' });
    const inProgressCount = fetchingCount + processingCount;
    statsDiv.appendChild(createElement('span', { className: 'stat complete', textContent: `${stats.complete} complete` }));
    statsDiv.appendChild(createElement('span', { className: 'stat downloaded', textContent: `${downloadedCount} downloaded` }));
    statsDiv.appendChild(createElement('span', { className: 'stat pending', textContent: `${inProgressCount} in progress` }));
    statsDiv.appendChild(createElement('span', { className: 'stat error', textContent: `${stats.error} failed` }));
    progressContainer.appendChild(statsDiv);

    jobItem.appendChild(progressContainer);
  }

  const metadataDiv = createElement('div', { className: 'job-metadata' });
  appendMetadataElements(metadataDiv, job, stats);
  jobItem.appendChild(metadataDiv);

  if (job.status === JobStatus.FAILED && job.metadata.errorMessage !== undefined && job.metadata.errorMessage !== '') {
    const errorDiv = createElement('div', { className: 'job-error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Error: ' }));
    errorDiv.appendChild(document.createTextNode(job.metadata.errorMessage));
    jobItem.appendChild(errorDiv);
  }

  // Actions
  const actionsDiv = createElement('div', { className: 'job-actions' });

  // Retry Failed button (only show if there are failed items)
  if (stats.error > 0) {
    const retryBtn = createElement('button', {
      className: 'btn btn-sm btn-primary',
      textContent: `Retry ${stats.error} Failed`,
      attributes: { type: 'button' }
    });
    retryBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying...';
      try {
        await retryFailedJobItems(job.id);
        // Trigger processing queue
        await chrome.runtime.sendMessage({
          type: 'bookmark:retry',
          data: { trigger: 'user_manual' }
        });
        void loadJobs();
      } catch (error) {
        console.error('Failed to retry:', error);
        retryBtn.disabled = false;
        retryBtn.textContent = `Retry ${stats.error} Failed`;
      }
    });
    actionsDiv.appendChild(retryBtn);
  }

  const dismissBtn = createElement('button', {
    className: 'btn btn-sm btn-secondary',
    textContent: 'Remove',
    attributes: { type: 'button' }
  });
  dismissBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteJob(job.id);
    expandedJobs.delete(job.id);
    void loadJobs();
  });
  actionsDiv.appendChild(dismissBtn);
  jobItem.appendChild(actionsDiv);

  // Show items list when expanded (use preloaded data)
  if (expandedJobs.has(job.id) && stats.total > 0) {
    const itemsContainer = createElement('div', { className: 'job-items-container' });

    // Sort: errors first, then in-progress, then pending, then complete
    const statusOrder: Record<JobItemStatus, number> = {
      [JobItemStatus.ERROR]: 0,
      [JobItemStatus.IN_PROGRESS]: 1,
      [JobItemStatus.PENDING]: 2,
      [JobItemStatus.COMPLETE]: 3,
    };
    const sortedItems = [...jobItems].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    for (const item of sortedItems) {
      const bookmark = data.bookmarks.get(item.bookmarkId);
      const itemEl = renderJobItemRow(item, bookmark);
      itemsContainer.appendChild(itemEl);
    }

    jobItem.appendChild(itemsContainer);
  }

  return jobItem;
}

function getEffectiveStatus(item: JobItem, bookmark: Bookmark | undefined): { class: string; label: string } {
  if (!bookmark) {
    return { class: getStatusClass(item.status), label: formatItemStatus(item.status) };
  }

  // Show more granular bookmark status when job item is pending
  if (item.status === JobItemStatus.PENDING) {
    if (bookmark.status === 'downloaded') {
      return { class: 'downloaded', label: 'Downloaded' };
    }
    if (bookmark.status === 'fetching') {
      return { class: 'fetching', label: 'Fetching' };
    }
  }

  // For other states, use job item status
  return { class: getStatusClass(item.status), label: formatItemStatus(item.status) };
}

function renderJobItemRow(item: JobItem, bookmark: Bookmark | undefined): HTMLElement {
  const effectiveStatus = getEffectiveStatus(item, bookmark);
  const row = createElement('div', { className: `job-item-row status-${item.status}` });

  // Status indicator
  const statusDot = createElement('span', {
    className: `status-indicator ${effectiveStatus.class}`,
  });
  row.appendChild(statusDot);

  // Bookmark info
  const infoDiv = createElement('div', { className: 'job-item-info' });
  if (bookmark) {
    const titleLink = createElement('a', {
      className: 'job-item-title',
      href: bookmark.url,
      target: '_blank',
      textContent: bookmark.title || bookmark.url,
    });
    titleLink.addEventListener('click', (e) => e.stopPropagation());
    infoDiv.appendChild(titleLink);

    const urlSpan = createElement('span', {
      className: 'job-item-url',
      textContent: new URL(bookmark.url).hostname,
    });
    infoDiv.appendChild(urlSpan);
  } else {
    infoDiv.appendChild(createElement('span', {
      className: 'job-item-title',
      textContent: 'Bookmark not found',
    }));
  }
  row.appendChild(infoDiv);

  // Status badge
  const statusBadge = createElement('span', {
    className: `job-item-status ${effectiveStatus.class}`,
    textContent: effectiveStatus.label,
  });
  row.appendChild(statusBadge);

  // Error message if present
  if (item.status === JobItemStatus.ERROR && item.errorMessage !== undefined && item.errorMessage !== '') {
    const errorDiv = createElement('div', {
      className: 'job-item-error',
      textContent: item.errorMessage,
    });
    row.appendChild(errorDiv);
  }

  // Retry count
  if (item.retryCount > 0) {
    const retrySpan = createElement('span', {
      className: 'job-item-retry',
      textContent: `(${item.retryCount} retries)`,
    });
    row.appendChild(retrySpan);
  }

  return row;
}

function getStatusClass(status: JobItemStatus): string {
  const classes: Record<JobItemStatus, string> = {
    [JobItemStatus.PENDING]: 'pending',
    [JobItemStatus.IN_PROGRESS]: 'in-progress',
    [JobItemStatus.COMPLETE]: 'complete',
    [JobItemStatus.ERROR]: 'error',
  };
  return classes[status];
}

function formatItemStatus(status: JobItemStatus): string {
  const labels: Record<JobItemStatus, string> = {
    [JobItemStatus.PENDING]: 'Pending',
    [JobItemStatus.IN_PROGRESS]: 'Processing',
    [JobItemStatus.COMPLETE]: 'Complete',
    [JobItemStatus.ERROR]: 'Failed',
  };
  return labels[status];
}

function createMetadataItem(label: string, value: string | number): HTMLElement {
  const item = createElement('div', { className: 'job-metadata-item' });
  item.appendChild(createElement('strong', { textContent: `${label}: ` }));
  item.appendChild(document.createTextNode(String(value)));
  return item;
}

function appendMetadataElements(container: HTMLElement, job: Job, stats: { total: number; complete: number; error: number }): void {
  let hasMetadata = false;

  if (job.metadata.url !== undefined && job.metadata.url !== '') {
    container.appendChild(createMetadataItem('URL', job.metadata.url));
    hasMetadata = true;
  }

  if (job.type === JobType.FILE_IMPORT) {
    if (job.metadata.fileName !== undefined && job.metadata.fileName !== '') {
      container.appendChild(createMetadataItem('File', job.metadata.fileName));
      hasMetadata = true;
    }
    if (job.metadata.importedCount !== undefined) {
      container.appendChild(createMetadataItem('Imported', job.metadata.importedCount));
      hasMetadata = true;
    }
    if (job.metadata.skippedCount !== undefined) {
      container.appendChild(createMetadataItem('Skipped', job.metadata.skippedCount));
      hasMetadata = true;
    }
  }

  if (job.type === JobType.BULK_URL_IMPORT) {
    if (job.metadata.totalUrls !== undefined) {
      container.appendChild(createMetadataItem('Total URLs', job.metadata.totalUrls));
      hasMetadata = true;
    }
    // Show success/failure counts from actual job items
    if (stats.total > 0) {
      container.appendChild(createMetadataItem('Completed', stats.complete));
      container.appendChild(createMetadataItem('Failed', stats.error));
      hasMetadata = true;
    }
  }

  if (!hasMetadata) {
    container.appendChild(createElement('div', { className: 'job-metadata-item', textContent: 'No additional information' }));
  }
}

function formatJobType(type: JobType): string {
  const labels: Record<JobType, string> = {
    [JobType.FILE_IMPORT]: 'File Import',
    [JobType.BULK_URL_IMPORT]: 'Bulk URL Import',
    [JobType.URL_FETCH]: 'URL Fetch',
  };
  return labels[type] || type;
}

jobTypeFilter.addEventListener('change', loadJobs);
jobStatusFilter.addEventListener('change', loadJobs);
refreshJobsBtn.addEventListener('click', loadJobs);

function init(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get('status');
  const typeParam = urlParams.get('type');

  if (statusParam !== null && statusParam !== '') {
    jobStatusFilter.value = statusParam;
  }
  if (typeParam !== null && typeParam !== '') {
    jobTypeFilter.value = typeParam;
  }

  void loadJobs();

  // Auto-refresh every 5 seconds for active jobs
  refreshIntervalId = window.setInterval(() => {
    void loadJobs();
  }, 5000);

  // Clear interval on page unload to prevent memory leak
  window.addEventListener('beforeunload', () => {
    if (refreshIntervalId !== undefined) {
      clearInterval(refreshIntervalId);
    }
  });
}

init();
