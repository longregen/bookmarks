import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type {
  Job,
  JobItem,
  JobType,
  JobStatus,
  JobItemStatus,
  Bookmark,
} from '../db/schema';
import { JobQueueError, RepositoryError } from '../lib/errors';
import { db } from '../../src/db/schema';
import { createElement } from '../../src/ui/dom';
import { formatTimeAgo } from '../../src/lib/time';

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Service for managing job operations in an Effect context
 */
export class JobService extends Context.Tag('JobService')<
  JobService,
  {
    /**
     * Get recent jobs with optional filtering
     */
    readonly getRecentJobs: (options?: {
      limit?: number;
      type?: JobType;
      status?: JobStatus;
      parentJobId?: string;
    }) => Effect.Effect<Job[], RepositoryError, never>;

    /**
     * Delete a job by ID
     */
    readonly deleteJob: (jobId: string) => Effect.Effect<void, RepositoryError, never>;

    /**
     * Get all items for a job
     */
    readonly getJobItems: (jobId: string) => Effect.Effect<JobItem[], RepositoryError, never>;

    /**
     * Get statistics for a job
     */
    readonly getJobStats: (jobId: string) => Effect.Effect<{
      total: number;
      pending: number;
      inProgress: number;
      complete: number;
      error: number;
    }, RepositoryError, never>;

    /**
     * Retry failed job items
     */
    readonly retryFailedJobItems: (jobId: string) => Effect.Effect<number, JobQueueError, never>;

    /**
     * Trigger job queue processing via message
     */
    readonly triggerQueueProcessing: () => Effect.Effect<void, never, never>;
  }
>() {}

// ============================================================================
// UI State Management
// ============================================================================

/**
 * UI state for job list
 */
interface JobListState {
  readonly expandedJobs: Set<string>;
  readonly refreshIntervalId?: number;
}

/**
 * Create initial state
 */
function createInitialState(): JobListState {
  return {
    expandedJobs: new Set<string>(),
    refreshIntervalId: undefined,
  };
}

// Global state (mutable for UI)
let state: JobListState = createInitialState();

// ============================================================================
// DOM Element References
// ============================================================================

/**
 * Get required DOM elements with validation
 */
function getDomElements() {
  return Effect.sync(() => {
    const jobTypeFilter = document.getElementById('jobTypeFilter') as HTMLSelectElement | null;
    const jobStatusFilter = document.getElementById('jobStatusFilter') as HTMLSelectElement | null;
    const refreshJobsBtn = document.getElementById('refreshJobsBtn') as HTMLButtonElement | null;
    const jobsList = document.getElementById('jobsList') as HTMLDivElement | null;

    if (!jobTypeFilter || !jobStatusFilter || !refreshJobsBtn || !jobsList) {
      throw new Error('Required DOM elements not found');
    }

    return { jobTypeFilter, jobStatusFilter, refreshJobsBtn, jobsList };
  });
}

// ============================================================================
// Job Loading and Rendering
// ============================================================================

/**
 * Load and display jobs with filters
 */
function loadJobs(): Effect.Effect<void, RepositoryError, JobService> {
  return Effect.gen(function* () {
    const jobService = yield* JobService;
    const elements = yield* getDomElements();

    // Show loading state
    elements.jobsList.textContent = '';
    elements.jobsList.appendChild(
      createElement('div', {
        className: 'loading',
        textContent: 'Loading jobs...',
      })
    );

    // Get all jobs
    const jobs = yield* jobService.getRecentJobs({ limit: 100 });

    // Apply filters
    const typeFilter = elements.jobTypeFilter.value;
    const statusFilter = elements.jobStatusFilter.value;

    let filteredJobs = jobs;

    if (typeFilter) {
      filteredJobs = filteredJobs.filter((job) => job.type === typeFilter);
    }

    if (statusFilter) {
      filteredJobs = filteredJobs.filter((job) => job.status === statusFilter);
    }

    // Render jobs
    if (filteredJobs.length === 0) {
      elements.jobsList.textContent = '';
      elements.jobsList.appendChild(
        createElement('div', {
          className: 'empty',
          textContent: 'No jobs found',
        })
      );
      return;
    }

    elements.jobsList.textContent = '';
    for (const job of filteredJobs) {
      const jobEl = yield* renderJobItem(job);
      elements.jobsList.appendChild(jobEl);
    }
  });
}

/**
 * Render a single job item
 */
function renderJobItem(
  job: Job
): Effect.Effect<HTMLElement, RepositoryError, JobService> {
  return Effect.gen(function* () {
    const jobService = yield* JobService;

    const typeLabel = formatJobType(job.type);
    const statusClass = job.status.toLowerCase();
    const statusLabel = job.status.replace('_', ' ').toUpperCase();
    const timestamp = formatTimeAgo(job.createdAt);

    const jobItem = createElement('div', {
      className: `job-item ${state.expandedJobs.has(job.id) ? 'expanded' : ''}`,
      attributes: { 'data-job-id': job.id },
    });

    // Header
    const header = createElement('div', { className: 'job-header' });
    const jobInfo = createElement('div', { className: 'job-info' });
    jobInfo.appendChild(
      createElement('div', { className: 'job-type', textContent: typeLabel })
    );
    jobInfo.appendChild(
      createElement('div', {
        className: 'job-timestamp',
        textContent: timestamp,
      })
    );
    header.appendChild(jobInfo);
    header.appendChild(
      createElement('div', {
        className: `job-status-badge ${statusClass}`,
        textContent: statusLabel,
      })
    );

    // Toggle expansion on click
    header.style.cursor = 'pointer';
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.job-actions')) return;
      if (state.expandedJobs.has(job.id)) {
        state.expandedJobs.delete(job.id);
      } else {
        state.expandedJobs.add(job.id);
      }
      void Effect.runPromise(loadJobs().pipe(Effect.provide(jobServiceLive)));
    });

    jobItem.appendChild(header);

    // Get job stats
    const stats = yield* jobService.getJobStats(job.id);

    // Progress bar for bulk imports
    if (job.type === 'bulk_url_import' && stats.total > 0) {
      const jobItems = yield* jobService.getJobItems(job.id);
      const bookmarkIds = jobItems.map((item) => item.bookmarkId);
      const bookmarks = yield* Effect.tryPromise({
        try: () => db.bookmarks.bulkGet(bookmarkIds),
        catch: (error) =>
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'bookmark',
            operation: 'query',
            message: 'Failed to load bookmarks for job items',
            originalError: error,
          }),
      });

      let downloadedCount = 0;
      let fetchingCount = 0;
      let processingCount = 0;

      for (const bookmark of bookmarks) {
        if (bookmark?.status === 'downloaded') downloadedCount++;
        else if (bookmark?.status === 'fetching') fetchingCount++;
        else if (bookmark?.status === 'processing') processingCount++;
      }

      const progressContainer = createElement('div', {
        className: 'job-progress-container',
      });

      // Progress bar
      const progressBar = createElement('div', { className: 'job-progress-bar' });
      const completedPercent = Math.round((stats.complete / stats.total) * 100);
      const errorPercent = Math.round((stats.error / stats.total) * 100);
      const downloadedPercent = Math.round((downloadedCount / stats.total) * 100);

      const completedFill = createElement('div', {
        className: 'job-progress-fill completed',
        style: { width: `${completedPercent}%` },
      });
      const downloadedFill = createElement('div', {
        className: 'job-progress-fill downloaded',
        style: { width: `${downloadedPercent}%` },
      });
      const errorFill = createElement('div', {
        className: 'job-progress-fill error',
        style: { width: `${errorPercent}%` },
      });

      progressBar.appendChild(completedFill);
      progressBar.appendChild(downloadedFill);
      progressBar.appendChild(errorFill);
      progressContainer.appendChild(progressBar);

      // Stats summary
      const statsDiv = createElement('div', { className: 'job-stats' });
      const inProgressCount = fetchingCount + processingCount;
      statsDiv.appendChild(
        createElement('span', {
          className: 'stat complete',
          textContent: `${stats.complete} complete`,
        })
      );
      statsDiv.appendChild(
        createElement('span', {
          className: 'stat downloaded',
          textContent: `${downloadedCount} downloaded`,
        })
      );
      statsDiv.appendChild(
        createElement('span', {
          className: 'stat pending',
          textContent: `${inProgressCount} in progress`,
        })
      );
      statsDiv.appendChild(
        createElement('span', {
          className: 'stat error',
          textContent: `${stats.error} failed`,
        })
      );
      progressContainer.appendChild(statsDiv);

      jobItem.appendChild(progressContainer);
    }

    // Metadata
    const metadataDiv = createElement('div', { className: 'job-metadata' });
    appendMetadataElements(metadataDiv, job, stats);
    jobItem.appendChild(metadataDiv);

    // Error message
    if (
      job.status === 'failed' &&
      job.metadata.errorMessage !== undefined &&
      job.metadata.errorMessage !== ''
    ) {
      const errorDiv = createElement('div', { className: 'job-error' });
      errorDiv.appendChild(createElement('strong', { textContent: 'Error: ' }));
      errorDiv.appendChild(document.createTextNode(job.metadata.errorMessage));
      jobItem.appendChild(errorDiv);
    }

    // Actions
    const actionsDiv = createElement('div', { className: 'job-actions' });

    // Retry button
    if (stats.error > 0) {
      const retryBtn = createElement('button', {
        className: 'btn btn-sm btn-primary',
        textContent: `Retry ${stats.error} Failed`,
        attributes: { type: 'button' },
      });
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void Effect.runPromise(
          handleRetryFailedItems(job.id, retryBtn).pipe(
            Effect.provide(jobServiceLive)
          )
        );
      });
      actionsDiv.appendChild(retryBtn);
    }

    // Remove button
    const dismissBtn = createElement('button', {
      className: 'btn btn-sm btn-secondary',
      textContent: 'Remove',
      attributes: { type: 'button' },
    });
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void Effect.runPromise(
        handleDeleteJob(job.id).pipe(Effect.provide(jobServiceLive))
      );
    });
    actionsDiv.appendChild(dismissBtn);
    jobItem.appendChild(actionsDiv);

    // Expanded items list
    if (state.expandedJobs.has(job.id) && stats.total > 0) {
      const itemsContainer = yield* renderJobItemsList(job.id);
      jobItem.appendChild(itemsContainer);
    }

    return jobItem;
  });
}

/**
 * Render job items list for expanded job
 */
function renderJobItemsList(
  jobId: string
): Effect.Effect<HTMLElement, RepositoryError, JobService> {
  return Effect.gen(function* () {
    const jobService = yield* JobService;
    const items = yield* jobService.getJobItems(jobId);

    // Sort: errors first, then in-progress, then pending, then complete
    const statusOrder: Record<JobItemStatus, number> = {
      error: 0,
      in_progress: 1,
      pending: 2,
      complete: 3,
    };
    items.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    // Batch load bookmarks (avoid N+1 query)
    const bookmarkIds = items.map((item) => item.bookmarkId);
    const bookmarks = yield* Effect.tryPromise({
      try: () => db.bookmarks.bulkGet(bookmarkIds),
      catch: (error) =>
        new RepositoryError({
          code: 'UNKNOWN',
          entity: 'bookmark',
          operation: 'query',
          message: 'Failed to load bookmarks for job items',
          originalError: error,
        }),
    });

    const bookmarkMap = new Map(
      bookmarks.map((bookmark, idx) => [bookmarkIds[idx], bookmark])
    );

    const itemsContainer = createElement('div', {
      className: 'job-items-container',
    });

    for (const item of items) {
      const bookmark = bookmarkMap.get(item.bookmarkId);
      const itemEl = renderJobItemRow(item, bookmark);
      itemsContainer.appendChild(itemEl);
    }

    return itemsContainer;
  });
}

/**
 * Render a single job item row
 */
function renderJobItemRow(
  item: JobItem,
  bookmark: Bookmark | undefined
): HTMLElement {
  const effectiveStatus = getEffectiveStatus(item, bookmark);
  const row = createElement('div', {
    className: `job-item-row status-${item.status}`,
  });

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
    infoDiv.appendChild(
      createElement('span', {
        className: 'job-item-title',
        textContent: 'Bookmark not found',
      })
    );
  }
  row.appendChild(infoDiv);

  // Status badge
  const statusBadge = createElement('span', {
    className: `job-item-status ${effectiveStatus.class}`,
    textContent: effectiveStatus.label,
  });
  row.appendChild(statusBadge);

  // Error message
  if (
    item.status === 'error' &&
    item.errorMessage !== undefined &&
    item.errorMessage !== ''
  ) {
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

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle retry failed items button click
 */
function handleRetryFailedItems(
  jobId: string,
  button: HTMLButtonElement
): Effect.Effect<void, JobQueueError, JobService> {
  return Effect.gen(function* () {
    const jobService = yield* JobService;

    // Disable button and show loading state
    button.disabled = true;
    button.textContent = 'Retrying...';

    try {
      // Retry failed items
      yield* jobService.retryFailedJobItems(jobId);

      // Trigger queue processing
      yield* jobService.triggerQueueProcessing();

      // Reload jobs
      yield* loadJobs();
    } catch (error) {
      // Re-enable button on error
      button.disabled = false;
      button.textContent = 'Retry Failed';
      throw error;
    }
  });
}

/**
 * Handle delete job button click
 */
function handleDeleteJob(
  jobId: string
): Effect.Effect<void, RepositoryError, JobService> {
  return Effect.gen(function* () {
    const jobService = yield* JobService;

    yield* jobService.deleteJob(jobId);
    state.expandedJobs.delete(jobId);
    yield* loadJobs();
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get effective status for job item display
 */
function getEffectiveStatus(
  item: JobItem,
  bookmark: Bookmark | undefined
): { class: string; label: string } {
  if (!bookmark) {
    return {
      class: getStatusClass(item.status),
      label: formatItemStatus(item.status),
    };
  }

  // Show granular bookmark status when job item is pending
  if (item.status === 'pending') {
    if (bookmark.status === 'downloaded') {
      return { class: 'downloaded', label: 'Downloaded' };
    }
    if (bookmark.status === 'fetching') {
      return { class: 'fetching', label: 'Fetching' };
    }
  }

  // Use job item status for other states
  return {
    class: getStatusClass(item.status),
    label: formatItemStatus(item.status),
  };
}

/**
 * Get CSS class for job item status
 */
function getStatusClass(status: JobItemStatus): string {
  const classes: Record<JobItemStatus, string> = {
    pending: 'pending',
    in_progress: 'in-progress',
    complete: 'complete',
    error: 'error',
  };
  return classes[status];
}

/**
 * Format job item status for display
 */
function formatItemStatus(status: JobItemStatus): string {
  const labels: Record<JobItemStatus, string> = {
    pending: 'Pending',
    in_progress: 'Processing',
    complete: 'Complete',
    error: 'Failed',
  };
  return labels[status];
}

/**
 * Format job type for display
 */
function formatJobType(type: JobType): string {
  const labels: Record<JobType, string> = {
    file_import: 'File Import',
    bulk_url_import: 'Bulk URL Import',
    url_fetch: 'URL Fetch',
  };
  return labels[type] || type;
}

/**
 * Create metadata item element
 */
function createMetadataItem(label: string, value: string | number): HTMLElement {
  const item = createElement('div', { className: 'job-metadata-item' });
  item.appendChild(createElement('strong', { textContent: `${label}: ` }));
  item.appendChild(document.createTextNode(String(value)));
  return item;
}

/**
 * Append metadata elements to container
 */
function appendMetadataElements(
  container: HTMLElement,
  job: Job,
  stats: { total: number; complete: number; error: number }
): void {
  let hasMetadata = false;

  if (job.metadata.url !== undefined && job.metadata.url !== '') {
    container.appendChild(createMetadataItem('URL', job.metadata.url));
    hasMetadata = true;
  }

  if (job.type === 'file_import') {
    if (job.metadata.fileName !== undefined && job.metadata.fileName !== '') {
      container.appendChild(createMetadataItem('File', job.metadata.fileName));
      hasMetadata = true;
    }
    if (job.metadata.importedCount !== undefined) {
      container.appendChild(
        createMetadataItem('Imported', job.metadata.importedCount)
      );
      hasMetadata = true;
    }
    if (job.metadata.skippedCount !== undefined) {
      container.appendChild(createMetadataItem('Skipped', job.metadata.skippedCount));
      hasMetadata = true;
    }
  }

  if (job.type === 'bulk_url_import') {
    if (job.metadata.totalUrls !== undefined) {
      container.appendChild(createMetadataItem('Total URLs', job.metadata.totalUrls));
      hasMetadata = true;
    }
    if (stats.total > 0) {
      container.appendChild(createMetadataItem('Completed', stats.complete));
      container.appendChild(createMetadataItem('Failed', stats.error));
      hasMetadata = true;
    }
  }

  if (!hasMetadata) {
    container.appendChild(
      createElement('div', {
        className: 'job-metadata-item',
        textContent: 'No additional information',
      })
    );
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the jobs UI
 */
function initialize(): Effect.Effect<void, never, JobService> {
  return Effect.gen(function* () {
    const elements = yield* getDomElements();

    // Get URL params for initial filters
    const urlParams = new URLSearchParams(window.location.search);
    const statusParam = urlParams.get('status');
    const typeParam = urlParams.get('type');

    if (statusParam !== null && statusParam !== '') {
      elements.jobStatusFilter.value = statusParam;
    }
    if (typeParam !== null && typeParam !== '') {
      elements.jobTypeFilter.value = typeParam;
    }

    // Set up event listeners
    elements.jobTypeFilter.addEventListener('change', () => {
      void Effect.runPromise(loadJobs().pipe(Effect.provide(jobServiceLive)));
    });

    elements.jobStatusFilter.addEventListener('change', () => {
      void Effect.runPromise(loadJobs().pipe(Effect.provide(jobServiceLive)));
    });

    elements.refreshJobsBtn.addEventListener('click', () => {
      void Effect.runPromise(loadJobs().pipe(Effect.provide(jobServiceLive)));
    });

    // Initial load
    yield* loadJobs();

    // Set up auto-refresh every 5 seconds
    const intervalId = window.setInterval(() => {
      void Effect.runPromise(loadJobs().pipe(Effect.provide(jobServiceLive)));
    }, 5000);

    state = { ...state, refreshIntervalId: intervalId };

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      if (state.refreshIntervalId !== undefined) {
        clearInterval(state.refreshIntervalId);
      }
    });
  });
}

// ============================================================================
// Service Implementation (Live Layer)
// ============================================================================

/**
 * Live implementation of JobService using Dexie database
 */
export const jobServiceLive: Layer.Layer<JobService, never, never> =
  Layer.succeed(JobService, {
    getRecentJobs: (options) =>
      Effect.tryPromise({
        try: async () => {
          const limit = options?.limit ?? 100;

          // Use indexed queries for better performance
          if (options?.parentJobId !== undefined) {
            let jobs = await db.jobs
              .where('parentJobId')
              .equals(options.parentJobId)
              .toArray();
            if (options.type !== undefined) {
              jobs = jobs.filter((job) => job.type === options.type);
            }
            if (options.status !== undefined) {
              jobs = jobs.filter((job) => job.status === options.status);
            }
            jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return jobs.slice(0, limit);
          }

          if (options?.status !== undefined) {
            let jobs = await db.jobs
              .where('status')
              .equals(options.status)
              .toArray();
            if (options.type !== undefined) {
              jobs = jobs.filter((job) => job.type === options.type);
            }
            jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return jobs.slice(0, limit);
          }

          if (options?.type !== undefined) {
            const jobs = await db.jobs.where('type').equals(options.type).toArray();
            jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return jobs.slice(0, limit);
          }

          // No filters - use createdAt index
          return db.jobs.orderBy('createdAt').reverse().limit(limit).toArray();
        },
        catch: (error) =>
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'job',
            operation: 'query',
            message: 'Failed to fetch recent jobs',
            originalError: error,
          }),
      }),

    deleteJob: (jobId) =>
      Effect.tryPromise({
        try: () => db.jobs.delete(jobId),
        catch: (error) =>
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'job',
            operation: 'delete',
            message: `Failed to delete job ${jobId}`,
            originalError: error,
          }),
      }),

    getJobItems: (jobId) =>
      Effect.tryPromise({
        try: () => db.jobItems.where('jobId').equals(jobId).toArray(),
        catch: (error) =>
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'jobItem',
            operation: 'query',
            message: `Failed to fetch items for job ${jobId}`,
            originalError: error,
          }),
      }),

    getJobStats: (jobId) =>
      Effect.gen(function* () {
        const items = yield* Effect.tryPromise({
          try: () => db.jobItems.where('jobId').equals(jobId).toArray(),
          catch: (error) =>
            new RepositoryError({
              code: 'UNKNOWN',
              entity: 'jobItem',
              operation: 'query',
              message: `Failed to fetch items for job ${jobId}`,
              originalError: error,
            }),
        });

        const stats = items.reduce<Record<string, number>>(
          (acc, item) => {
            acc[item.status]++;
            return acc;
          },
          { pending: 0, in_progress: 0, complete: 0, error: 0 }
        );

        return {
          total: items.length,
          pending: stats.pending,
          inProgress: stats.in_progress,
          complete: stats.complete,
          error: stats.error,
        };
      }),

    retryFailedJobItems: (jobId) =>
      Effect.gen(function* () {
        const items = yield* Effect.tryPromise({
          try: () =>
            db.jobItems
              .where('[jobId+status]')
              .equals([jobId, 'error'])
              .toArray(),
          catch: (error) =>
            new JobQueueError({
              jobId,
              code: 'UNKNOWN',
              message: 'Failed to fetch failed job items',
              originalError: error,
            }),
        });

        const now = new Date();
        const bookmarkIds = items.map((item) => item.bookmarkId);

        // Batch update job items
        yield* Effect.tryPromise({
          try: () =>
            Promise.all(
              items.map((item) =>
                db.jobItems.update(item.id, {
                  status: 'pending' as JobItemStatus,
                  retryCount: 0,
                  errorMessage: undefined,
                  updatedAt: now,
                })
              )
            ),
          catch: (error) =>
            new JobQueueError({
              jobId,
              code: 'UNKNOWN',
              message: 'Failed to update job items',
              originalError: error,
            }),
        });

        // Batch update bookmarks
        yield* Effect.tryPromise({
          try: () =>
            Promise.all(
              bookmarkIds.map((bookmarkId) =>
                db.bookmarks.update(bookmarkId, {
                  status: 'fetching',
                  errorMessage: undefined,
                  retryCount: 0,
                  updatedAt: now,
                })
              )
            ),
          catch: (error) =>
            new JobQueueError({
              jobId,
              code: 'UNKNOWN',
              message: 'Failed to update bookmarks',
              originalError: error,
            }),
        });

        // Update job status
        yield* Effect.tryPromise({
          try: async () => {
            const allItems = await db.jobItems.where('jobId').equals(jobId).toArray();
            const stats = allItems.reduce<Record<string, number>>(
              (acc, item) => {
                acc[item.status]++;
                return acc;
              },
              { pending: 0, in_progress: 0, complete: 0, error: 0 }
            );

            let status: JobStatus;
            const total = allItems.length;

            if (total === 0) {
              status = 'completed';
            } else if (stats.complete === total) {
              status = 'completed';
            } else if (
              stats.error > 0 &&
              stats.pending === 0 &&
              stats.in_progress === 0
            ) {
              status = stats.complete > 0 ? 'completed' : 'failed';
            } else if (stats.in_progress > 0 || stats.pending > 0) {
              status = 'in_progress';
            } else {
              status = 'completed';
            }

            await db.jobs.update(jobId, { status });
          },
          catch: (error) =>
            new JobQueueError({
              jobId,
              code: 'UNKNOWN',
              message: 'Failed to update job status',
              originalError: error,
            }),
        });

        return items.length;
      }),

    triggerQueueProcessing: () =>
      Effect.tryPromise({
        try: async () => {
          await chrome.runtime.sendMessage({
            type: 'bookmark:retry',
            data: { trigger: 'user_manual' },
          });
        },
        catch: () => {
          // Ignore errors from message sending (might not be in extension context)
        },
      }).pipe(Effect.orElseSucceed(() => undefined)),
  });

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Run the initialization when the page loads
 */
const initEffect = initialize().pipe(
  Effect.provide(jobServiceLive),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error('Failed to initialize jobs UI:', error);
    })
  )
);

// Run the effect
// Skip during tests to avoid initialization errors
if (!import.meta.vitest) {
  Effect.runPromise(initEffect);
}
