import { validateUrls } from '../../lib/bulk-import';
import { getRecentJobs, type Job } from '../../lib/jobs';
import { JobType, JobStatus } from '../../db/schema';
import { createElement, showStatusMessage } from '../../lib/dom';
import { formatTimeAgo } from '../../lib/time';
import { onEvent, EventType, type JobUpdateData } from '../../lib/events';

export function initializeJobsPanel() {
  const statusDiv = document.getElementById('status') as HTMLDivElement;

  // Bulk Import elements
  const bulkUrlsInput = document.getElementById('bulkUrlsInput') as HTMLTextAreaElement;
  const urlValidationFeedback = document.getElementById('urlValidationFeedback') as HTMLDivElement;
  const startBulkImportBtn = document.getElementById('startBulkImport') as HTMLButtonElement;
  const cancelBulkImportBtn = document.getElementById('cancelBulkImport') as HTMLButtonElement;
  const bulkImportProgress = document.getElementById('bulkImportProgress') as HTMLDivElement;
  const bulkImportProgressBar = document.getElementById('bulkImportProgressBar') as HTMLDivElement;
  const bulkImportStatus = document.getElementById('bulkImportStatus') as HTMLSpanElement;

  // Jobs Dashboard elements
  const jobTypeFilter = document.getElementById('jobTypeFilter') as HTMLSelectElement;
  const jobStatusFilter = document.getElementById('jobStatusFilter') as HTMLSelectElement;
  const refreshJobsBtn = document.getElementById('refreshJobsBtn') as HTMLButtonElement;
  const jobsList = document.getElementById('jobsList') as HTMLDivElement;

  let currentBulkImportJobId: string | null = null;
  let bulkImportPollingInterval: number | null = null;
  let jobsPollingInterval: number | null = null;
  let jobsUnsubscribe: (() => void) | null = null;

  // Bulk import URL validation (debounced)
  let validationTimeout: number | null = null;
  bulkUrlsInput.addEventListener('input', () => {
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }

    validationTimeout = window.setTimeout(() => {
      const urlsText = bulkUrlsInput.value.trim();

      if (!urlsText) {
        urlValidationFeedback.classList.remove('show');
        startBulkImportBtn.disabled = true;
        return;
      }

      const validation = validateUrls(urlsText);

      if (validation.validUrls.length === 0) {
        urlValidationFeedback.className = 'validation-feedback show invalid';
        urlValidationFeedback.textContent = 'No valid URLs found';
        startBulkImportBtn.disabled = true;
        return;
      }

      // Show validation feedback
      let feedbackClass = 'validation-feedback show valid';
      let feedbackText = `${validation.validUrls.length} valid URL(s)`;

      if (validation.invalidUrls.length > 0) {
        feedbackClass = 'validation-feedback show warning';
        feedbackText += `, ${validation.invalidUrls.length} invalid URL(s)`;
      }

      if (validation.duplicates.length > 0) {
        feedbackClass = 'validation-feedback show warning';
        feedbackText += `, ${validation.duplicates.length} duplicate(s)`;
      }

      urlValidationFeedback.className = feedbackClass;
      urlValidationFeedback.textContent = feedbackText;
      startBulkImportBtn.disabled = false;
    }, 500);
  });

  // Start bulk import
  startBulkImportBtn.addEventListener('click', async () => {
    const urlsText = bulkUrlsInput.value.trim();
    if (!urlsText) return;

    const validation = validateUrls(urlsText);
    if (validation.validUrls.length === 0) {
      showStatusMessage(statusDiv, 'No valid URLs to import', 'error', 5000);
      return;
    }

    try {
      startBulkImportBtn.disabled = true;
      cancelBulkImportBtn.style.display = 'inline-block';
      bulkImportProgress.classList.remove('hidden');
      bulkImportProgressBar.style.width = '0%';
      bulkImportStatus.textContent = 'Starting import...';

      // Send message to background script to start bulk import
      const response = await chrome.runtime.sendMessage({
        type: 'START_BULK_IMPORT',
        urls: validation.validUrls,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to start bulk import');
      }

      currentBulkImportJobId = response.jobId;

      // Start polling for progress
      bulkImportPollingInterval = window.setInterval(async () => {
        if (!currentBulkImportJobId) return;

        const jobResponse = await chrome.runtime.sendMessage({
          type: 'GET_JOB_STATUS',
          jobId: currentBulkImportJobId,
        });

        if (jobResponse.success && jobResponse.job) {
          const job = jobResponse.job;

          // Update progress bar
          bulkImportProgressBar.style.width = `${job.progress}%`;

          // Update status text
          const successCount = job.metadata.successCount || 0;
          const failureCount = job.metadata.failureCount || 0;
          const totalUrls = job.metadata.totalUrls || 0;
          bulkImportStatus.textContent = `Imported ${successCount} of ${totalUrls} URLs (${failureCount} failed)`;

          // Check if completed
          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            if (bulkImportPollingInterval) {
              clearInterval(bulkImportPollingInterval);
              bulkImportPollingInterval = null;
            }

            currentBulkImportJobId = null;
            startBulkImportBtn.disabled = false;
            cancelBulkImportBtn.style.display = 'none';

            if (job.status === 'completed') {
              showStatusMessage(statusDiv, `Bulk import completed! Imported ${successCount} URLs (${failureCount} failed)`, 'success', 5000);
              bulkUrlsInput.value = '';
              urlValidationFeedback.classList.remove('show');
            } else if (job.status === 'failed') {
              showStatusMessage(statusDiv, 'Bulk import failed: ' + (job.metadata.errorMessage || 'Unknown error'), 'error', 5000);
            } else {
              showStatusMessage(statusDiv, 'Bulk import cancelled', 'error', 5000);
            }

            // Refresh jobs list
            loadJobs();
          }
        }
      }, 1000);

      showStatusMessage(statusDiv, `Started importing ${validation.validUrls.length} URLs`, 'success', 5000);
    } catch (error) {
      console.error('Error starting bulk import:', error);
      showStatusMessage(statusDiv, 'Failed to start bulk import: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error', 5000);
      startBulkImportBtn.disabled = false;
      cancelBulkImportBtn.style.display = 'none';
      bulkImportProgress.classList.add('hidden');

      if (bulkImportPollingInterval) {
        clearInterval(bulkImportPollingInterval);
        bulkImportPollingInterval = null;
      }
    }
  });

  // Cancel bulk import
  cancelBulkImportBtn.addEventListener('click', async () => {
    if (currentBulkImportJobId && bulkImportPollingInterval) {
      clearInterval(bulkImportPollingInterval);
      bulkImportPollingInterval = null;
      currentBulkImportJobId = null;
      startBulkImportBtn.disabled = false;
      cancelBulkImportBtn.style.display = 'none';
      showStatusMessage(statusDiv, 'Bulk import cancelled', 'error', 5000);
    }
  });

  // Jobs filter handlers
  jobTypeFilter.addEventListener('change', loadJobs);
  jobStatusFilter.addEventListener('change', loadJobs);
  refreshJobsBtn.addEventListener('click', loadJobs);

  // Load jobs on initialization
  loadJobs();
  startJobsPolling();

  // Cleanup function
  window.addEventListener('beforeunload', () => {
    if (bulkImportPollingInterval) {
      clearInterval(bulkImportPollingInterval);
    }
    if (jobsPollingInterval) {
      clearInterval(jobsPollingInterval);
    }
    if (jobsUnsubscribe) {
      jobsUnsubscribe();
    }
  });

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

  function createMetadataItem(label: string, value: string | number): HTMLElement {
    const item = createElement('div', { className: 'job-metadata-item' });
    item.appendChild(createElement('strong', { textContent: `${label}: ` }));
    item.appendChild(document.createTextNode(String(value)));
    return item;
  }

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

  function startJobsPolling() {
    // Clean up existing listeners and intervals
    if (jobsPollingInterval) {
      clearInterval(jobsPollingInterval);
    }
    if (jobsUnsubscribe) {
      jobsUnsubscribe();
    }

    // Listen for job update events from background (event-driven)
    const updateUnsubscribe = onEvent<JobUpdateData>(
      EventType.JOB_UPDATED,
      () => {
        // Refresh jobs list when any job is updated
        loadJobs();
      }
    );

    // Also listen for job completion and failure events
    const completedUnsubscribe = onEvent<JobUpdateData>(
      EventType.JOB_COMPLETED,
      () => {
        loadJobs();
      }
    );

    const failedUnsubscribe = onEvent<JobUpdateData>(
      EventType.JOB_FAILED,
      () => {
        loadJobs();
      }
    );

    // Store combined cleanup function
    jobsUnsubscribe = () => {
      updateUnsubscribe();
      completedUnsubscribe();
      failedUnsubscribe();
    };

    // Also set up a fallback poll with a much longer interval (60s) for reliability
    jobsPollingInterval = window.setInterval(() => {
      // Only auto-refresh if there are active jobs
      const hasActiveJobs = document.querySelectorAll('.job-status-badge.in_progress').length > 0;
      if (hasActiveJobs) {
        loadJobs();
      }
    }, 60000); // Fallback poll every 60 seconds
  }
}
