import { validateUrls, createBulkImportJob } from '../../lib/bulk-import';
import { showStatusMessage } from '../../lib/dom';
import { db } from '../../db/schema';
import { createPoller, type Poller } from '../../lib/polling-manager';
import { getErrorMessage } from '../../lib/errors';
import { processBulkFetch } from '../../background/fetcher';

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

async function checkBulkImportProgress(): Promise<void> {
  if (currentBulkImportJobId === null || currentBulkImportJobId === '') return;

  const job = await db.jobs.get(currentBulkImportJobId);

  if (job !== undefined) {
    bulkImportProgressBar.style.width = `${job.progress}%`;

    const successCount = job.metadata.successCount ?? 0;
    const failureCount = job.metadata.failureCount ?? 0;
    const totalUrls = job.metadata.totalUrls ?? 0;
    bulkImportStatus.textContent = `Imported ${successCount} of ${totalUrls} URLs (${failureCount} failed)`;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      bulkImportPoller.stop();

      currentBulkImportJobId = null;
      startBulkImportBtn.disabled = false;
      cancelBulkImportBtn.style.display = 'none';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (job.status === 'completed') {
        showStatusMessage(statusDiv, `Bulk import completed! Imported ${successCount} URLs (${failureCount} failed)`, 'success', 5000);
        bulkUrlsInput.value = '';
        urlValidationFeedback.classList.remove('show');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      } else if (job.status === 'failed') {
        const errorMsg = (job.metadata.errorMessage !== undefined && job.metadata.errorMessage !== '') ? job.metadata.errorMessage : 'Unknown error';
        showStatusMessage(statusDiv, `Bulk import failed: ${errorMsg}`, 'error', 5000);
      } else {
        showStatusMessage(statusDiv, 'Bulk import cancelled', 'error', 5000);
      }

      const event = new CustomEvent('refresh-jobs');
      window.dispatchEvent(event);
    }
  }
}

const bulkImportPoller: Poller = createPoller(
  () => checkBulkImportProgress(),
  1000
);

bulkUrlsInput.addEventListener('input', () => {
  if (validationTimeout !== null) {
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
      jobId = await createBulkImportJob(validation.validUrls);
      currentBulkImportJobId = jobId;

      // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
      processBulkFetch(jobId).catch(error => {
        console.error('Error in bulk fetch processing:', error);
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const response = await chrome.runtime.sendMessage({
        type: 'START_BULK_IMPORT',
        urls: validation.validUrls,
      });

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access
      if (!response.success) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing
        throw new Error(response.error || 'Failed to start bulk import');
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unsafe-member-access
      jobId = response.jobId!;
      currentBulkImportJobId = jobId;
    }

    bulkImportPoller.start();

    showStatusMessage(statusDiv, `Started importing ${validation.validUrls.length} URLs`, 'success', 5000);
  } catch (error) {
    console.error('Error starting bulk import:', error);
    showStatusMessage(statusDiv, `Failed to start bulk import: ${  getErrorMessage(error)}`, 'error', 5000);
    startBulkImportBtn.disabled = false;
    cancelBulkImportBtn.style.display = 'none';
    bulkImportProgress.classList.add('hidden');

    bulkImportPoller.stop();
  }
});

cancelBulkImportBtn.addEventListener('click', () => {
  if (currentBulkImportJobId !== null && currentBulkImportJobId !== '') {
    bulkImportPoller.stop();
    currentBulkImportJobId = null;
    startBulkImportBtn.disabled = false;
    cancelBulkImportBtn.style.display = 'none';
    showStatusMessage(statusDiv, 'Bulk import cancelled', 'error', 5000);
  }
});

function stopBulkImportPolling(): void {
  bulkImportPoller.stop();
}

export function initBulkImportModule(): () => void {
  // Hide bulk import section for web platform (CORS prevents fetching external URLs)
  if (__IS_WEB__) {
    const bulkImportSection = document.getElementById('bulk-import');
    if (bulkImportSection) {
      bulkImportSection.style.display = 'none';
    }
    return () => {};
  }

  return (): void => {
    stopBulkImportPolling();
  };
}
