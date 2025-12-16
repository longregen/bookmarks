import { getSettings, saveSetting } from '../lib/settings';
import { exportAllBookmarks, downloadExport, readImportFile, importBookmarks } from '../lib/export';
import { validateUrls } from '../lib/bulk-import';
import { getRecentJobs, type Job } from '../lib/jobs';
import { db, JobType, JobStatus } from '../db/schema';
import { createElement, showStatusMessage } from '../lib/dom';
import { formatTimeAgo } from '../lib/time';
import { onThemeChange, applyTheme, getTheme, setTheme, type Theme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';

const form = document.getElementById('settingsForm') as HTMLFormElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const navLibrary = document.getElementById('navLibrary') as HTMLAnchorElement;
const navSearch = document.getElementById('navSearch') as HTMLAnchorElement;
const navStumble = document.getElementById('navStumble') as HTMLAnchorElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const chatModelInput = document.getElementById('chatModel') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;

// WebDAV form elements
const webdavForm = document.getElementById('webdavForm') as HTMLFormElement;
const webdavEnabledInput = document.getElementById('webdavEnabled') as HTMLInputElement;
const webdavFieldsDiv = document.getElementById('webdavFields') as HTMLDivElement;
const webdavUrlInput = document.getElementById('webdavUrl') as HTMLInputElement;
const webdavUsernameInput = document.getElementById('webdavUsername') as HTMLInputElement;
const webdavPasswordInput = document.getElementById('webdavPassword') as HTMLInputElement;
const webdavPathInput = document.getElementById('webdavPath') as HTMLInputElement;
const testWebdavBtn = document.getElementById('testWebdavBtn') as HTMLButtonElement;
const webdavConnectionStatus = document.getElementById('webdavConnectionStatus') as HTMLDivElement;

// Import/Export elements
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFileName = document.getElementById('importFileName') as HTMLSpanElement;
const importStatus = document.getElementById('importStatus') as HTMLDivElement;

async function loadSettings() {
  try {
    const settings = await getSettings();

    apiBaseUrlInput.value = settings.apiBaseUrl;
    apiKeyInput.value = settings.apiKey;
    chatModelInput.value = settings.chatModel;
    embeddingModelInput.value = settings.embeddingModel;
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatusMessage(statusDiv, 'Failed to load settings', 'error', 5000);
  }
}

async function loadWebDAVSettings() {
  try {
    const settings = await getSettings();

    webdavEnabledInput.checked = settings.webdavEnabled;
    webdavUrlInput.value = settings.webdavUrl;
    webdavUsernameInput.value = settings.webdavUsername;
    webdavPasswordInput.value = settings.webdavPassword;
    webdavPathInput.value = settings.webdavPath;

    // Show/hide fields based on enabled state
    updateWebDAVFieldsVisibility();
  } catch (error) {
    console.error('Error loading WebDAV settings:', error);
  }
}

function updateWebDAVFieldsVisibility() {
  if (webdavEnabledInput.checked) {
    webdavFieldsDiv.classList.remove('hidden');
  } else {
    webdavFieldsDiv.classList.add('hidden');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    await saveSetting('apiBaseUrl', apiBaseUrlInput.value.trim());
    await saveSetting('apiKey', apiKeyInput.value.trim());
    await saveSetting('chatModel', chatModelInput.value.trim());
    await saveSetting('embeddingModel', embeddingModelInput.value.trim());

    showStatusMessage(statusDiv, 'Settings saved successfully!', 'success', 5000);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatusMessage(statusDiv, 'Failed to save settings', 'error', 5000);

    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  }
});

testBtn.addEventListener('click', async () => {
  try {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    const settings = {
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      embeddingModel: embeddingModelInput.value.trim(),
    };

    if (!settings.apiKey) {
      showStatusMessage(statusDiv, 'Please enter an API key first', 'error', 5000);
      return;
    }

    // Test the API with a simple embedding request
    const response = await fetch(`${settings.apiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.embeddingModel,
        input: ['test'],
      }),
    });

    if (response.ok) {
      showStatusMessage(statusDiv, 'Connection successful! API is working correctly.', 'success', 5000);
    } else {
      const error = await response.text();
      showStatusMessage(statusDiv, `Connection failed: ${response.status} - ${error}`, 'error', 5000);
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    showStatusMessage(statusDiv, `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', 5000);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

// WebDAV form handlers
webdavEnabledInput.addEventListener('change', updateWebDAVFieldsVisibility);

webdavForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = webdavForm.querySelector('[type="submit"]') as HTMLButtonElement;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    await saveSetting('webdavEnabled', webdavEnabledInput.checked);
    await saveSetting('webdavUrl', webdavUrlInput.value.trim());
    await saveSetting('webdavUsername', webdavUsernameInput.value.trim());
    await saveSetting('webdavPassword', webdavPasswordInput.value);
    await saveSetting('webdavPath', webdavPathInput.value.trim() || '/bookmarks');

    showStatusMessage(statusDiv, 'WebDAV settings saved successfully!', 'success', 5000);
  } catch (error) {
    console.error('Error saving WebDAV settings:', error);
    showStatusMessage(statusDiv, 'Failed to save WebDAV settings', 'error', 5000);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  }
});

testWebdavBtn.addEventListener('click', async () => {
  const url = webdavUrlInput.value.trim();
  const username = webdavUsernameInput.value.trim();
  const password = webdavPasswordInput.value;

  if (!url || !username || !password) {
    showConnectionStatus('error', 'Please fill in URL, username, and password');
    return;
  }

  showConnectionStatus('testing', 'Testing connection...');
  testWebdavBtn.disabled = true;

  try {
    const result = await testWebDAVConnection(url, username, password);

    if (result.success) {
      showConnectionStatus('success', 'Connection successful!');
    } else {
      showConnectionStatus('error', result.error || 'Connection failed');
    }
  } catch (error) {
    showConnectionStatus('error', `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    testWebdavBtn.disabled = false;
  }
});

function showConnectionStatus(type: 'success' | 'error' | 'testing', message: string) {
  webdavConnectionStatus.className = `connection-status ${type}`;
  const statusText = webdavConnectionStatus.querySelector('.status-text');
  if (statusText) {
    statusText.textContent = message;
  }
}

interface WebDAVTestResult {
  success: boolean;
  error?: string;
}

async function testWebDAVConnection(
  url: string,
  username: string,
  password: string
): Promise<WebDAVTestResult> {
  try {
    // Use PROPFIND to test WebDAV connection
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Depth': '0',
        'Authorization': 'Basic ' + btoa(`${username}:${password}`),
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
    });

    // WebDAV returns 207 Multi-Status for successful PROPFIND
    if (response.status === 207 || response.ok) {
      return { success: true };
    }

    if (response.status === 401) {
      return { success: false, error: 'Authentication failed. Check username and password.' };
    }

    if (response.status === 404) {
      return { success: false, error: 'Path not found. Check the server URL.' };
    }

    return { success: false, error: `Server returned status ${response.status}` };
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { success: false, error: 'Network error. Check the URL and your connection.' };
    }
    throw error;
  }
}

// Navigate to pages (same tab)
navLibrary.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('src/library/library.html');
});

navSearch.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('src/search/search.html');
});

navStumble.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('src/stumble/stumble.html');
});

// Import/Export functionality
let selectedFile: File | null = null;

exportBtn.addEventListener('click', async () => {
  try {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    const exportData = await exportAllBookmarks();

    if (exportData.bookmarkCount === 0) {
      showStatusMessage(statusDiv, 'No bookmarks to export', 'error', 5000);
      return;
    }

    downloadExport(exportData);
    showStatusMessage(statusDiv, `Exported ${exportData.bookmarkCount} bookmark(s) successfully!`, 'success', 5000);
  } catch (error) {
    console.error('Error exporting bookmarks:', error);
    showStatusMessage(statusDiv, 'Failed to export bookmarks', 'error', 5000);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export All Bookmarks';
  }
});

importFile.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    selectedFile = file;
    importFileName.textContent = file.name;
    importBtn.disabled = false;
  } else {
    selectedFile = null;
    importFileName.textContent = '';
    importBtn.disabled = true;
  }

  // Clear any previous import status
  importStatus.classList.add('hidden');
});

importBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  try {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';

    const exportData = await readImportFile(selectedFile);
    const result = await importBookmarks(exportData, selectedFile.name);

    // Show result
    let message = `Imported ${result.imported} bookmark(s)`;
    if (result.skipped > 0) {
      message += `, skipped ${result.skipped} duplicate(s)`;
    }

    // Build import result using DOM APIs (CSP-safe)
    importStatus.textContent = ''; // Clear existing content
    const resultDiv = createElement('div', {
      className: `import-result ${result.success ? 'success' : 'warning'}`
    });
    resultDiv.appendChild(createElement('strong', { textContent: message }));

    if (result.errors.length > 0) {
      const errorList = createElement('ul', { className: 'import-errors' });
      for (const err of result.errors) {
        errorList.appendChild(createElement('li', { textContent: err }));
      }
      resultDiv.appendChild(errorList);
    }

    importStatus.appendChild(resultDiv);
    importStatus.classList.remove('hidden');

    // Reset file input
    importFile.value = '';
    selectedFile = null;
    importFileName.textContent = '';
  } catch (error) {
    console.error('Error importing bookmarks:', error);
    // Build error result using DOM APIs (CSP-safe)
    importStatus.textContent = '';
    const errorDiv = createElement('div', { className: 'import-result error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Import failed: ' }));
    errorDiv.appendChild(document.createTextNode(error instanceof Error ? error.message : 'Unknown error'));
    importStatus.appendChild(errorDiv);
    importStatus.classList.remove('hidden');
  } finally {
    importBtn.disabled = true;
    importBtn.textContent = 'Import';
  }
});

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

// Jobs Dashboard functions
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

// Stop polling when leaving the page
window.addEventListener('beforeunload', () => {
  if (bulkImportPollingInterval) {
    clearInterval(bulkImportPollingInterval);
  }
  if (jobsPollingInterval) {
    clearInterval(jobsPollingInterval);
  }
});

// Theme selector
const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

async function loadTheme() {
  const theme = await getTheme();
  const radio = document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`);
  if (radio) {
    radio.checked = true;
  }
}

themeRadios.forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.checked) {
      await setTheme(target.value as Theme);
    }
  });
});

// Initialize theme
initExtension();
onThemeChange((theme) => applyTheme(theme));

// Sidebar Navigation
const navItems = document.querySelectorAll<HTMLAnchorElement>('.nav-item');
const sections = document.querySelectorAll<HTMLElement>('.settings-section');

function setActiveNavItem(sectionId: string) {
  navItems.forEach(item => {
    if (item.dataset.section === sectionId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Handle nav item clicks
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = item.dataset.section;
    if (sectionId) {
      setActiveNavItem(sectionId);
      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
});

// Track scroll position to update active nav item
function setupScrollObserver() {
  const scrollContainer = document.querySelector('.app-layout__content');
  const observerOptions: IntersectionObserverInit = {
    root: scrollContainer,
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sectionId = entry.target.id;
        setActiveNavItem(sectionId);
      }
    });
  }, observerOptions);

  sections.forEach(section => {
    observer.observe(section);
  });
}

// Only setup scroll observer on desktop
if (window.matchMedia('(min-width: 1024px)').matches) {
  setupScrollObserver();
}

// Re-setup observer on resize
window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 1024px)').matches) {
    setupScrollObserver();
  }
});

// Load settings on page load
loadSettings();
loadWebDAVSettings();
loadTheme();

// Load jobs on page load
loadJobs();
startJobsPolling();
