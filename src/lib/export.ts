// Re-export all non-DOM functionality from export-data.ts for backwards compatibility
export {
  exportSingleBookmark,
  exportAllBookmarks,
  importBookmarks,
  validateImportData,
  type ExportedBookmark,
  type BookmarkExport,
  type ImportResult,
} from './export-data';

import { validateImportData, type BookmarkExport } from './export-data';

// DOM-dependent functions below

export function downloadExport(data: BookmarkExport, filename?: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const defaultFilename = data.bookmarkCount === 1
    ? `bookmark-${sanitizeFilename(data.bookmarks[0].title)}-${formatDateForFilename(new Date())}.json`
    : `bookmarks-export-${formatDateForFilename(new Date())}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function formatDateForFilename(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function readImportFile(file: File): Promise<BookmarkExport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text) as unknown;

        if (!validateImportData(data)) {
          reject(new Error('Invalid bookmark export file format'));
          return;
        }

        resolve(data);
      } catch (_error) {
        reject(new Error('Failed to parse JSON file'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
