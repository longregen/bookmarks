import { getRecentJobs, formatJobType, type Job } from '../../lib/jobs';
import { JobType, JobStatus } from '../../db/schema';
import { createElement } from '../../ui/dom';
import { formatTimeAgo } from '../../lib/time';

const jobTypeFilter = document.getElementById('jobTypeFilter') as HTMLSelectElement;
const jobStatusFilter = document.getElementById('jobStatusFilter') as HTMLSelectElement;
const refreshJobsBtn = document.getElementById('refreshJobsBtn') as HTMLButtonElement;
const jobsList = document.getElementById('jobsList') as HTMLDivElement;

async function loadJobs(): Promise<void> {
  try {
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'loading', textContent: 'Loading jobs...' }));

    const typeFilter = jobTypeFilter.value as JobType | '';
    const statusFilter = jobStatusFilter.value as JobStatus | '';

    const jobs = await getRecentJobs({
      limit: 100,
      type: typeFilter || undefined,
      status: statusFilter || undefined,
    });

    if (jobs.length === 0) {
      jobsList.textContent = '';
      jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'No jobs found' }));
      return;
    }

    jobsList.textContent = '';
    const fragment = document.createDocumentFragment();
    for (const job of jobs) {
      const jobEl = renderJobItemElement(job);
      fragment.appendChild(jobEl);
    }
    jobsList.appendChild(fragment);
  } catch (error) {
    console.error('Error loading jobs:', error);
    jobsList.textContent = '';
    jobsList.appendChild(createElement('div', { className: 'empty', textContent: 'Error loading jobs' }));
  }
}

function renderJobItemElement(job: Job): HTMLElement {
  const typeLabel = formatJobType(job.type);
  const statusClass = job.status.toLowerCase();
  const statusLabel = job.status.replace('_', ' ').toUpperCase();
  const timestamp = formatTimeAgo(job.createdAt);

  const jobItem = createElement('div', {
    className: 'job-item',
    attributes: { 'data-job-id': job.id }
  });

  const header = createElement('div', { className: 'job-header' });
  const jobInfo = createElement('div', { className: 'job-info' });
  jobInfo.appendChild(createElement('div', { className: 'job-type', textContent: typeLabel }));
  jobInfo.appendChild(createElement('div', { className: 'job-timestamp', textContent: timestamp }));
  header.appendChild(jobInfo);
  header.appendChild(createElement('div', { className: `job-status-badge ${statusClass}`, textContent: statusLabel }));
  jobItem.appendChild(header);

  const metadataDiv = createElement('div', { className: 'job-metadata' });
  appendMetadataElements(metadataDiv, job);
  jobItem.appendChild(metadataDiv);

  if (job.status === JobStatus.FAILED && job.metadata.errorMessage !== undefined && job.metadata.errorMessage !== '') {
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
    container.appendChild(createElement('div', { className: 'job-metadata-item', textContent: 'No additional information' }));
  }
}

jobTypeFilter.addEventListener('change', () => void loadJobs());
jobStatusFilter.addEventListener('change', () => void loadJobs());
refreshJobsBtn.addEventListener('click', () => void loadJobs());

jobsList.addEventListener('click', (e) => {
  const jobEl = (e.target as HTMLElement).closest('.job-item');
  if (jobEl) {
    jobEl.classList.toggle('expanded');
  }
});

export function initJobsModule(): () => void {
  void loadJobs();
  return () => {};
}
