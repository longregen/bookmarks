import type { BookmarkExport } from '../lib/export';

export type ExportFormat = 'json' | 'markdown' | 'html' | 'copy-markdown';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadExport(data: BookmarkExport, filename?: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const defaultFilename = data.bookmarkCount === 1
    ? `bookmark-${sanitizeFilename(data.bookmarks[0].title)}-${formatDateForFilename(new Date())}.json`
    : `bookmarks-export-${formatDateForFilename(new Date())}.json`;

  downloadBlob(blob, filename ?? defaultFilename);
}

export function downloadMarkdown(content: string, title: string): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const filename = `bookmark-${sanitizeFilename(title)}-${formatDateForFilename(new Date())}.md`;
  downloadBlob(blob, filename);
}

export async function copyMarkdown(content: string): Promise<void> {
  await navigator.clipboard.writeText(content);
}

export function downloadHtml(content: string, title: string): void {
  const blob = new Blob([content], { type: 'text/html' });
  const filename = `bookmark-${sanitizeFilename(title)}-${formatDateForFilename(new Date())}.html`;
  downloadBlob(blob, filename);
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
