import { getRecentJobs, type Job } from '../../lib/jobs';
import { JobType, JobStatus } from '../../db/schema';
import { createElement } from '../../lib/dom';
import { formatTimeAgo } from '../../lib/time';

// Jobs Dashboard elements
const jobTypeFilter = document.getElementById('jobTypeFilter') as HTMLSelectElement;
const jobStatusFilter = document.getElementById('jobStatusFilter') as HTMLSelectElement;
const refreshJobsBtn = document.getElementById('refreshJobsBtn') as HTMLButtonElement;
const jobsList = document.getElementById('jobsList') as HTMLDivElement;

let jobsPollingInterval: number | null = null;

async function loadJobs() {
  try {
    // Clear and show loading using DOM APIs (CSP-safe)
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'loading', textContent: 'Loading jobs...' }));

    // Get recent jobs from database
    const jobs = await getRecentJobs({ limit: 100 });

    // Apply filters
    const typeFilter = jobTypeFilter.value;
    const statusFilter = jobStatusFilter.value;

    let filteredJobs = jobs;

    if (typeFilter) {
      filteredJobs = filteredJobs.filter(job => job.type === typeFilter);
    }

    if (statusFilter) {
      filteredJobs = filteredJobs.filter(job => job.status === statusFilter);
    }

    if (filteredJobs.length === 0) {
      jobsList.textContent = '';
      jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'No jobs found' }));
      return;
    }

    // Render jobs using DOM APIs
    jobsList.textContent = '';
    for (const job of filteredJobs) {
      const jobEl = renderJobItemElement(job);
      jobEl.addEventListener('click', () => {
        jobEl.classList.toggle('expanded');
      });
      jobsList.appendChild(jobEl);
    }
  } catch (error) {
    console.error('Error loading jobs:', error);
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'Error loading jobs' }));
  }
}

/**
 * Create a job item element using DOM APIs (CSP-safe)
 */
function renderJobItemElement(job: Job): HTMLElement {
  const typeLabel = formatJobType(job.type);
  const statusClass = job.status.toLowerCase();
  const statusLabel = job.status.replace('_', ' ').toUpperCase();
  const timestamp = formatTimeAgo(job.createdAt);

  const jobItem = createElement('div', {
    className: 'job-item',
    attributes: { 'data-job-id': job.id }
  });

  // Job header
  const header = createElement('div', { className: 'job-header' });
  const jobInfo = createElement('div', { className: 'job-info' });
  jobInfo.appendChild(createElement('div', { className: 'job-type', textContent: typeLabel }));
  jobInfo.appendChild(createElement('div', { className: 'job-timestamp', textContent: timestamp }));
  header.appendChild(jobInfo);
  header.appendChild(createElement('div', { className: `job-status-badge ${statusClass}`, textContent: statusLabel }));
  jobItem.appendChild(header);

  // Progress bar (if applicable)
  if (job.progress > 0 && job.status === JobStatus.IN_PROGRESS) {
    const progressDiv = createElement('div', { className: 'job-progress' });
    const progressBar = createElement('div', { className: 'job-progress-bar' });
    progressBar.appendChild(createElement('div', {
      className: 'job-progress-fill',
      style: { width: `${job.progress}%` }
    }));
    progressDiv.appendChild(progressBar);
    progressDiv.appendChild(createElement('div', { className: 'job-progress-text', textContent: `${job.progress}%` }));
    jobItem.appendChild(progressDiv);
  }

  // Current step
  if (job.currentStep) {
    jobItem.appendChild(createElement('div', { className: 'job-step', textContent: job.currentStep }));
  }

  // Metadata
  const metadataDiv = createElement('div', { className: 'job-metadata' });
  appendMetadataElements(metadataDiv, job);
  jobItem.appendChild(metadataDiv);

  // Error message
  if (job.status === JobStatus.FAILED && job.metadata.errorMessage) {
    const errorDiv = createElement('div', { className: 'job-error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Error: ' }));
    errorDiv.appendChild(document.createTextNode(job.metadata.errorMessage));
    jobItem.appendChild(errorDiv);
  }

  return jobItem;
}

/**
 * Helper to create a metadata item element
 */
function createMetadataItem(label: string, value: string | number): HTMLElement {
  const item = createElement('div', { className: 'job-metadata-item' });
  item.appendChild(createElement('strong', { textContent: `${label}: ` }));
  item.appendChild(document.createTextNode(String(value)));
  return item;
}

/**
 * Append metadata elements to container using DOM APIs
 */
function appendMetadataElements(container: HTMLElement, job: Job): void {
  let hasMetadata = false;

  // Common metadata
  if (job.metadata.url) {
    container.appendChild(createMetadataItem('URL', job.metadata.url));
    hasMetadata = true;
  }

  if (job.metadata.title) {
    container.appendChild(createMetadataItem('Title', job.metadata.title));
    hasMetadata = true;
  }

  // Type-specific metadata
  if (job.type === JobType.MARKDOWN_GENERATION) {
    if (job.metadata.characterCount) {
      container.appendChild(createMetadataItem('Characters', job.metadata.characterCount.toLocaleString()));
      hasMetadata = true;
    }
    if (job.metadata.wordCount) {
      container.appendChild(createMetadataItem('Words', job.metadata.wordCount.toLocaleString()));
      hasMetadata = true;
    }
  }

  if (job.type === JobType.QA_GENERATION) {
    if (job.metadata.pairsGenerated) {
      container.appendChild(createMetadataItem('Q&A Pairs', job.metadata.pairsGenerated));
      hasMetadata = true;
    }
  }

  if (job.type === JobType.FILE_IMPORT) {
    if (job.metadata.fileName) {
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
    if (job.metadata.totalUrls) {
      container.appendChild(createMetadataItem('Total URLs', job.metadata.totalUrls));
      hasMetadata = true;
    }
    if (job.metadata.successCount !== undefined) {
      container.appendChild(createMetadataItem('Success', job.metadata.successCount));
      hasMetadata = true;
    }
    if (job.metadata.failureCount !== undefined) {
      container.appendChild(createMetadataItem('Failed', job.metadata.failureCount));
      hasMetadata = true;
    }
  }

  if (!hasMetadata) {
    container.appendChild(createElement('div', { className: 'job-metadata-item', textContent: 'No additional information' }));
  }
}

function formatJobType(type: JobType): string {
  const labels: Record<JobType, string> = {
    [JobType.MANUAL_ADD]: 'Manual Add',
    [JobType.MARKDOWN_GENERATION]: 'Markdown Generation',
    [JobType.QA_GENERATION]: 'Q&A Generation',
    [JobType.FILE_IMPORT]: 'File Import',
    [JobType.BULK_URL_IMPORT]: 'Bulk URL Import',
    [JobType.URL_FETCH]: 'URL Fetch',
  };
  return labels[type] || type;
}

// Jobs filter handlers
jobTypeFilter.addEventListener('change', loadJobs);
jobStatusFilter.addEventListener('change', loadJobs);
refreshJobsBtn.addEventListener('click', loadJobs);

// Start polling for jobs updates
function startJobsPolling() {
  if (jobsPollingInterval) {
    clearInterval(jobsPollingInterval);
  }

  jobsPollingInterval = window.setInterval(() => {
    // Only auto-refresh if there are active jobs
    const hasActiveJobs = document.querySelectorAll('.job-status-badge.in_progress').length > 0;
    if (hasActiveJobs) {
      loadJobs();
    }
  }, 2000);
}

function stopJobsPolling() {
  if (jobsPollingInterval) {
    clearInterval(jobsPollingInterval);
  }
}

// Listen for refresh events from other modules
window.addEventListener('refresh-jobs', () => {
  loadJobs();
});

export function initJobsModule() {
  loadJobs();
  startJobsPolling();

  // Return cleanup function
  return () => {
    stopJobsPolling();
  };
}
