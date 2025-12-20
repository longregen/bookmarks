import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { makeLayer, makeEffectLayer } from '../../lib/effect-utils';
import { JobType, JobStatus, type Job } from '../../src/db/schema';
import { db } from '../../src/db/schema';
import { createElement } from '../../src/ui/dom';
import { formatTimeAgo } from '../../src/lib/time';

// ============================================================================
// Typed Errors
// ============================================================================

export class JobQueryError extends Data.TaggedError('JobQueryError')<{
  readonly operation: 'query' | 'filter';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// JobRepository Service
// ============================================================================

export class JobRepository extends Context.Tag('JobRepository')<
  JobRepository,
  {
    readonly getRecentJobs: (options?: {
      limit?: number;
      type?: JobType;
      status?: JobStatus;
      parentJobId?: string;
    }) => Effect.Effect<Job[], JobQueryError>;
  }
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

const JobRepositoryLive = makeLayer(JobRepository, {
  getRecentJobs: (options) =>
    Effect.tryPromise({
      try: async () => {
        const limit = options?.limit ?? 100;

        // Use indexed queries when possible for better performance
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

        // No filters - use createdAt index for ordering
        return db.jobs.orderBy('createdAt').reverse().limit(limit).toArray();
      },
      catch: (cause) =>
        new JobQueryError({
          operation: 'query',
          message: 'Failed to query jobs from database',
          cause,
        }),
    }),
});

// ============================================================================
// UI State
// ============================================================================

interface UIElements {
  readonly jobTypeFilter: HTMLSelectElement;
  readonly jobStatusFilter: HTMLSelectElement;
  readonly refreshJobsBtn: HTMLButtonElement;
  readonly jobsList: HTMLDivElement;
}

function getUIElements(): UIElements {
  return {
    jobTypeFilter: document.getElementById('jobTypeFilter') as HTMLSelectElement,
    jobStatusFilter: document.getElementById('jobStatusFilter') as HTMLSelectElement,
    refreshJobsBtn: document.getElementById('refreshJobsBtn') as HTMLButtonElement,
    jobsList: document.getElementById('jobsList') as HTMLDivElement,
  };
}

// ============================================================================
// Effect-based Load Jobs
// ============================================================================

function loadJobsEffect(ui: UIElements): Effect.Effect<void, JobQueryError, JobRepository> {
  return Effect.gen(function* () {
    const jobRepo = yield* JobRepository;

    // Show loading state
    ui.jobsList.textContent = '';
    ui.jobsList.appendChild(
      createElement('div', {
        className: 'loading',
        textContent: 'Loading jobs...',
      })
    );

    // Get filter values
    const typeFilter = ui.jobTypeFilter.value as JobType | '';
    const statusFilter = ui.jobStatusFilter.value as JobStatus | '';

    // Query jobs
    const jobs = yield* jobRepo.getRecentJobs({
      limit: 100,
      type: typeFilter || undefined,
      status: statusFilter || undefined,
    });

    // Render results
    if (jobs.length === 0) {
      ui.jobsList.textContent = '';
      ui.jobsList.appendChild(
        createElement('div', {
          className: 'empty',
          textContent: 'No jobs found',
        })
      );
      return;
    }

    ui.jobsList.textContent = '';
    const fragment = document.createDocumentFragment();
    for (const job of jobs) {
      const jobEl = renderJobItemElement(job);
      fragment.appendChild(jobEl);
    }
    ui.jobsList.appendChild(fragment);
  });
}

// ============================================================================
// DOM Rendering (Pure Functions)
// ============================================================================

function renderJobItemElement(job: Job): HTMLElement {
  const typeLabel = formatJobType(job.type);
  const statusClass = job.status.toLowerCase();
  const statusLabel = job.status.replace('_', ' ').toUpperCase();
  const timestamp = formatTimeAgo(job.createdAt);

  const jobItem = createElement('div', {
    className: 'job-item',
    attributes: { 'data-job-id': job.id },
  });

  const header = createElement('div', { className: 'job-header' });
  const jobInfo = createElement('div', { className: 'job-info' });
  jobInfo.appendChild(createElement('div', { className: 'job-type', textContent: typeLabel }));
  jobInfo.appendChild(createElement('div', { className: 'job-timestamp', textContent: timestamp }));
  header.appendChild(jobInfo);
  header.appendChild(
    createElement('div', {
      className: `job-status-badge ${statusClass}`,
      textContent: statusLabel,
    })
  );
  jobItem.appendChild(header);

  const metadataDiv = createElement('div', { className: 'job-metadata' });
  appendMetadataElements(metadataDiv, job);
  jobItem.appendChild(metadataDiv);

  if (
    job.status === JobStatus.FAILED &&
    job.metadata.errorMessage !== undefined &&
    job.metadata.errorMessage !== ''
  ) {
    const errorDiv = createElement('div', { className: 'job-error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Error: ' }));
    errorDiv.appendChild(document.createTextNode(job.metadata.errorMessage));
    jobItem.appendChild(errorDiv);
  }

  return jobItem;
}

function createMetadataItem(label: string, value: string | number): HTMLElement {
  const item = createElement('div', { className: 'job-metadata-item' });
  item.appendChild(createElement('strong', { textContent: `${label}: ` }));
  item.appendChild(document.createTextNode(String(value)));
  return item;
}

function appendMetadataElements(container: HTMLElement, job: Job): void {
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

function formatJobType(type: JobType): string {
  const labels: Record<JobType, string> = {
    [JobType.FILE_IMPORT]: 'File Import',
    [JobType.BULK_URL_IMPORT]: 'Bulk URL Import',
    [JobType.URL_FETCH]: 'URL Fetch',
  };
  return labels[type] || type;
}

// ============================================================================
// Event Handlers with Effect Runtime
// ============================================================================

function setupEventHandlers(ui: UIElements, runEffect: <A, E>(effect: Effect.Effect<A, E, JobRepository>) => Promise<void>): void {
  const loadJobs = (): void => {
    void runEffect(loadJobsEffect(ui));
  };

  ui.jobTypeFilter.addEventListener('change', loadJobs);
  ui.jobStatusFilter.addEventListener('change', loadJobs);
  ui.refreshJobsBtn.addEventListener('click', loadJobs);

  ui.jobsList.addEventListener('click', (e) => {
    const jobEl = (e.target as HTMLElement).closest('.job-item');
    if (jobEl) {
      jobEl.classList.toggle('expanded');
    }
  });
}

// ============================================================================
// Public API
// ============================================================================

export function initJobsModule(): () => void {
  const ui = getUIElements();

  // Create runtime with layers
  const runtime = Effect.runSync(
    Layer.toRuntime(JobRepositoryLive)
  );

  // Helper to run effects with the runtime
  const runEffect = <A, E>(effect: Effect.Effect<A, E, JobRepository>): Promise<void> => {
    return Effect.runPromise(
      Effect.provide(effect, JobRepositoryLive).pipe(
        Effect.catchAll((error) => {
          console.error('Error loading jobs:', error);
          ui.jobsList.textContent = '';
          ui.jobsList.appendChild(
            createElement('div', {
              className: 'empty',
              textContent: 'Error loading jobs',
            })
          );
          return Effect.void;
        })
      )
    );
  };

  // Setup event handlers
  setupEventHandlers(ui, runEffect);

  // Load initial jobs
  void runEffect(loadJobsEffect(ui));

  // Return cleanup function
  return () => {
    runtime.dispose();
  };
}
