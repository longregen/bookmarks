import { db } from '../../db/schema';
import { validateUrls, createBulkImportJob } from '../../lib/bulk-import';
import { showStatusMessage } from '../../ui/dom';
import { getErrorMessage } from '../../lib/errors';
import { startProcessingQueue } from '../../background/queue';

const bulkUrlsInput = document.getElementById('bulkUrlsInput') as HTMLTextAreaElement;
const urlValidationFeedback = document.getElementById('urlValidationFeedback') as HTMLDivElement;
const startBulkImportBtn = document.getElementById('startBulkImport') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const bulkImportProgress = document.getElementById('bulkImportProgress') as HTMLDivElement;
const bulkImportProgressBar = document.getElementById('bulkImportProgressBar') as HTMLDivElement;
const bulkImportStatus = document.getElementById('bulkImportStatus') as HTMLSpanElement;

let validationTimeout: number | null = null;
let progressPollInterval: number | null = null;

bulkUrlsInput.addEventListener('input', () => {
  clearTimeout(validationTimeout ?? undefined);

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

async function pollProgress(urls: string[]): Promise<void> {
  const total = urls.length;
  let lastStatusText = '';

  const checkProgress = async (): Promise<void> => {
    try {
      const bookmarks = await db.bookmarks
        .where('url')
        .anyOf(urls)
        .toArray();

      let downloaded = 0;
      let completed = 0;
      let errors = 0;
      let processing = 0;

      for (const b of bookmarks) {
        if (b.status === 'error') {
          errors++;
        } else if (b.status === 'complete') {
          completed++;
        } else if (b.status === 'downloaded' || b.status === 'pending') {
          downloaded++;
        } else if (b.status === 'processing') {
          processing++;
        }
      }

      const finishedCount = completed + errors;
      const percent = Math.round((finishedCount / total) * 100);
      bulkImportProgressBar.style.width = `${percent}%`;

      // Show granular status
      let statusText: string;
      if (finishedCount >= total) {
        statusText = `Completed ${completed} of ${total}`;
      } else if (downloaded > 0 || processing > 0) {
        statusText = `Downloaded ${downloaded + completed + processing + errors}/${total}, Processing ${completed}/${total}`;
      } else {
        statusText = `Fetching ${total - finishedCount} pages...`;
      }

      if (statusText !== lastStatusText) {
        bulkImportStatus.textContent = statusText;
        lastStatusText = statusText;
      }

      if (finishedCount >= total) {
        // All done
        stopProgressPolling();

        if (errors > 0) {
          showStatusMessage(statusDiv, `Bulk import completed with ${errors} error(s)`, 'warning', 5000);
        } else {
          showStatusMessage(statusDiv, 'Bulk import completed successfully', 'success', 5000);
        }

        // Keep showing final status for a moment, then hide
        setTimeout(() => {
          bulkImportProgress.classList.add('hidden');
        }, 3000);

        const event = new CustomEvent('refresh-jobs');
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error('Error polling progress:', error);
    }
  };

  // Initial check
  await checkProgress();

  // Poll every second
  progressPollInterval = window.setInterval(() => {
    void checkProgress();
  }, 1000);
}

function stopProgressPolling(): void {
  if (progressPollInterval !== null) {
    clearInterval(progressPollInterval);
    progressPollInterval = null;
  }
}

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

    // Show progress UI
    bulkImportProgress.classList.remove('hidden');
    bulkImportProgressBar.style.width = '0%';
    bulkImportStatus.textContent = `Imported 0 of ${validation.validUrls.length}`;

    if (__IS_WEB__) {
      await createBulkImportJob(validation.validUrls);
      void startProcessingQueue();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const response = await chrome.runtime.sendMessage({
        type: 'import:create_from_url_list',
        urls: validation.validUrls,
      });

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access
      if (!response.success) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-nullish-coalescing
        throw new Error(response.error || 'Failed to start bulk import');
      }
    }

    bulkUrlsInput.value = '';
    urlValidationFeedback.classList.remove('show');

    // Start polling for progress
    void pollProgress(validation.validUrls);

  } catch (error) {
    console.error('Error starting bulk import:', error);
    showStatusMessage(statusDiv, `Failed to start bulk import: ${getErrorMessage(error)}`, 'error', 5000);
    bulkImportProgress.classList.add('hidden');
    stopProgressPolling();
  } finally {
    startBulkImportBtn.disabled = false;
  }
});

export function initBulkImportModule(): () => void {
  // Hide bulk import section for web platform (CORS prevents fetching external URLs)
  if (__IS_WEB__) {
    const bulkImportSection = document.getElementById('bulk-import');
    if (bulkImportSection) {
      bulkImportSection.style.display = 'none';
    }
  }

  return () => {
    stopProgressPolling();
  };
}
