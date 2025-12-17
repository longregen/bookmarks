import { exportAllBookmarks, readImportFile, importBookmarks } from '../../lib/export';
import { downloadExport } from '../../ui/export-download';
import { showStatusMessage, createElement } from '../../ui/dom';
import { withButtonState } from '../../ui/form-helper';
import { getErrorMessage } from '../../lib/errors';

const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const importFile = document.getElementById('importFile') as HTMLInputElement;
const importBtn = document.getElementById('importBtn') as HTMLButtonElement;
const importFileName = document.getElementById('importFileName') as HTMLSpanElement;
const importStatus = document.getElementById('importStatus') as HTMLDivElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let selectedFile: File | null = null;

exportBtn.addEventListener('click', async () => {
  try {
    await withButtonState(exportBtn, 'Exporting...', async () => {
      const exportData = await exportAllBookmarks();

      if (exportData.bookmarkCount === 0) {
        showStatusMessage(statusDiv, 'No bookmarks to export', 'error', 5000);
        return;
      }

      downloadExport(exportData);
      showStatusMessage(statusDiv, `Exported ${exportData.bookmarkCount} bookmark(s) successfully!`, 'success', 5000);
    });
  } catch (error) {
    console.error('Error exporting bookmarks:', error);
    showStatusMessage(statusDiv, 'Failed to export bookmarks', 'error', 5000);
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

  importStatus.classList.add('hidden');
});

importBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  const file = selectedFile;

  try {
    await withButtonState(importBtn, 'Importing...', async () => {
      const exportData = await readImportFile(file);
      const result = await importBookmarks(exportData, file.name);

      let message = `Imported ${result.imported} bookmark(s)`;
      if (result.skipped > 0) {
        message += `, skipped ${result.skipped} duplicate(s)`;
      }

      // Build import result using DOM APIs (CSP-safe)
      importStatus.textContent = '';
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

      importFile.value = '';
      selectedFile = null;
      importFileName.textContent = '';
    });
  } catch (error) {
    console.error('Error importing bookmarks:', error);
    // Build error result using DOM APIs (CSP-safe)
    importStatus.textContent = '';
    const errorDiv = createElement('div', { className: 'import-result error' });
    errorDiv.appendChild(createElement('strong', { textContent: 'Import failed: ' }));
    errorDiv.appendChild(document.createTextNode(getErrorMessage(error)));
    importStatus.appendChild(errorDiv);
    importStatus.classList.remove('hidden');
  }
});
