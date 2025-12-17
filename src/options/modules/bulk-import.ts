import { validateUrls, createBulkImportJob } from '../../lib/bulk-import';
import { showStatusMessage } from '../../ui/dom';
import { getErrorMessage } from '../../lib/errors';
import { startProcessingQueue } from '../../background/queue';

const bulkUrlsInput = document.getElementById('bulkUrlsInput') as HTMLTextAreaElement;
const urlValidationFeedback = document.getElementById('urlValidationFeedback') as HTMLDivElement;
const startBulkImportBtn = document.getElementById('startBulkImport') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let validationTimeout: number | null = null;

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

    if (__IS_WEB__) {
      await createBulkImportJob(validation.validUrls);
      void startProcessingQueue();
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
    }

    showStatusMessage(statusDiv, `Started importing ${validation.validUrls.length} URLs. Check bookmarks for progress.`, 'success', 5000);
    bulkUrlsInput.value = '';
    urlValidationFeedback.classList.remove('show');

    const event = new CustomEvent('refresh-jobs');
    window.dispatchEvent(event);
  } catch (error) {
    console.error('Error starting bulk import:', error);
    showStatusMessage(statusDiv, `Failed to start bulk import: ${getErrorMessage(error)}`, 'error', 5000);
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

  return () => {};
}
