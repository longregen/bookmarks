import { validateUrls, createBulkImportJob } from '../../lib/bulk-import';
import { showStatusMessage } from '../../lib/dom';
import { db } from '../../db/schema';
import { createPoller, type Poller } from '../../lib/polling-manager';
import type { StartBulkImportResponse } from '../../lib/messages';
import { getErrorMessage } from '../../lib/errors';

// Web-only imports for direct bulk import processing
import { processBulkFetch } from '../../background/fetcher';

// Bulk Import elements
const bulkUrlsInput = document.getElementById('bulkUrlsInput') as HTMLTextAreaElement;
const urlValidationFeedback = document.getElementById('urlValidationFeedback') as HTMLDivElement;
const startBulkImportBtn = document.getElementById('startBulkImport') as HTMLButtonElement;
const cancelBulkImportBtn = document.getElementById('cancelBulkImport') as HTMLButtonElement;
const bulkImportProgress = document.getElementById('bulkImportProgress') as HTMLDivElement;
const bulkImportProgressBar = document.getElementById('bulkImportProgressBar') as HTMLDivElement;
const bulkImportStatus = document.getElementById('bulkImportStatus') as HTMLSpanElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let currentBulkImportJobId: string | null = null;
let validationTimeout: number | null = null;

// Polling callback for bulk import progress
async function checkBulkImportProgress() {
  if (!currentBulkImportJobId) return;

  // Get job status directly from database (works for both web and extension)
  const job = await db.jobs.get(currentBulkImportJobId);

  if (job) {
    // Update progress bar
    bulkImportProgressBar.style.width = `${job.progress}%`;

    // Update status text
    const successCount = job.metadata.successCount || 0;
    const failureCount = job.metadata.failureCount || 0;
    const totalUrls = job.metadata.totalUrls || 0;
    bulkImportStatus.textContent = `Imported ${successCount} of ${totalUrls} URLs (${failureCount} failed)`;

    // Check if completed
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      bulkImportPoller.stop();

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

      // Trigger jobs list refresh (if available)
      const event = new CustomEvent('refresh-jobs');
      window.dispatchEvent(event);
    }
  }
}

const bulkImportPoller: Poller = createPoller(
  () => checkBulkImportProgress(),
  1000 // Poll every second
);

// Bulk import URL validation (debounced)
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

    let jobId: string;

    if (__IS_WEB__) {
      // Web: Call bulk import functions directly (no service worker)
      jobId = await createBulkImportJob(validation.validUrls);
      currentBulkImportJobId = jobId;

      // Start processing in background (don't await)
      processBulkFetch(jobId).catch(error => {
        console.error('Error in bulk fetch processing:', error);
      });
    } else {
      // Extension: Send message to background script to start bulk import
      const response = await chrome.runtime.sendMessage({
        type: 'START_BULK_IMPORT',
        urls: validation.validUrls,
      }) as StartBulkImportResponse;

      if (!response.success) {
        throw new Error(response.error || 'Failed to start bulk import');
      }

      jobId = response.jobId!;
      currentBulkImportJobId = jobId;
    }

    // Start polling for progress (works for both web and extension)
    bulkImportPoller.start();

    showStatusMessage(statusDiv, `Started importing ${validation.validUrls.length} URLs`, 'success', 5000);
  } catch (error) {
    console.error('Error starting bulk import:', error);
    showStatusMessage(statusDiv, 'Failed to start bulk import: ' + getErrorMessage(error), 'error', 5000);
    startBulkImportBtn.disabled = false;
    cancelBulkImportBtn.style.display = 'none';
    bulkImportProgress.classList.add('hidden');

    bulkImportPoller.stop();
  }
});

// Cancel bulk import
cancelBulkImportBtn.addEventListener('click', async () => {
  if (currentBulkImportJobId) {
    bulkImportPoller.stop();
    currentBulkImportJobId = null;
    startBulkImportBtn.disabled = false;
    cancelBulkImportBtn.style.display = 'none';
    showStatusMessage(statusDiv, 'Bulk import cancelled', 'error', 5000);
  }
});

function stopBulkImportPolling() {
  bulkImportPoller.stop();
}

export function initBulkImportModule() {
  // Hide bulk import section for web platform (CORS limitation)
  if (__IS_WEB__) {
    const bulkImportSection = document.getElementById('bulk-import');
    if (bulkImportSection) {
      bulkImportSection.style.display = 'none';
    }
    return () => {}; // No cleanup needed for web
  }

  // Module is initialized via event listeners

  // Return cleanup function
  return () => {
    stopBulkImportPolling();
  };
}
