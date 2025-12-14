import { getSettings, saveSetting } from '../lib/settings';
import { exportAllBookmarks, downloadExport, readImportFile, importBookmarks } from '../lib/export';

const form = document.getElementById('settingsForm') as HTMLFormElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const chatModelInput = document.getElementById('chatModel') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;

// Import/Export elements
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFileName = document.getElementById('importFileName') as HTMLSpanElement;
const importStatus = document.getElementById('importStatus') as HTMLDivElement;

function showStatus(message: string, type: 'success' | 'error') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;

  setTimeout(() => {
    statusDiv.classList.add('hidden');
  }, 5000);
}

async function loadSettings() {
  try {
    const settings = await getSettings();

    apiBaseUrlInput.value = settings.apiBaseUrl;
    apiKeyInput.value = settings.apiKey;
    chatModelInput.value = settings.chatModel;
    embeddingModelInput.value = settings.embeddingModel;
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Failed to load settings', 'error');
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

    showStatus('Settings saved successfully!', 'success');

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Failed to save settings', 'error');

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
      showStatus('Please enter an API key first', 'error');
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
      showStatus('Connection successful! API is working correctly.', 'success');
    } else {
      const error = await response.text();
      showStatus(`Connection failed: ${response.status} - ${error}`, 'error');
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    showStatus(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

// Navigate back to explore page
backBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/explore/explore.html') });
});

// Import/Export functionality
let selectedFile: File | null = null;

exportBtn.addEventListener('click', async () => {
  try {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    const exportData = await exportAllBookmarks();

    if (exportData.bookmarkCount === 0) {
      showStatus('No bookmarks to export', 'error');
      return;
    }

    downloadExport(exportData);
    showStatus(`Exported ${exportData.bookmarkCount} bookmark(s) successfully!`, 'success');
  } catch (error) {
    console.error('Error exporting bookmarks:', error);
    showStatus('Failed to export bookmarks', 'error');
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
    const result = await importBookmarks(exportData);

    // Show result
    let message = `Imported ${result.imported} bookmark(s)`;
    if (result.skipped > 0) {
      message += `, skipped ${result.skipped} duplicate(s)`;
    }

    importStatus.innerHTML = `
      <div class="import-result ${result.success ? 'success' : 'warning'}">
        <strong>${message}</strong>
        ${result.errors.length > 0 ? `
          <ul class="import-errors">
            ${result.errors.map(err => `<li>${err}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `;
    importStatus.classList.remove('hidden');

    // Reset file input
    importFile.value = '';
    selectedFile = null;
    importFileName.textContent = '';
  } catch (error) {
    console.error('Error importing bookmarks:', error);
    importStatus.innerHTML = `
      <div class="import-result error">
        <strong>Import failed:</strong> ${error instanceof Error ? error.message : 'Unknown error'}
      </div>
    `;
    importStatus.classList.remove('hidden');
  } finally {
    importBtn.disabled = true;
    importBtn.textContent = 'Import';
  }
});

// Load settings on page load
loadSettings();
