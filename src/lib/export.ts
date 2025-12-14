import { db, Bookmark, Markdown, QuestionAnswer } from '../db/schema';

// Export format version for future compatibility
const EXPORT_VERSION = 1;

export interface ExportedBookmark {
  id: string;
  url: string;
  title: string;
  status: Bookmark['status'];
  createdAt: string;
  updatedAt: string;
  markdown?: string;
  questionsAnswers: Array<{
    question: string;
    answer: string;
  }>;
}

export interface BookmarkExport {
  version: number;
  exportedAt: string;
  bookmarkCount: number;
  bookmarks: ExportedBookmark[];
}

/**
 * Export a single bookmark with its related data
 */
export async function exportSingleBookmark(bookmarkId: string): Promise<BookmarkExport> {
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) {
    throw new Error(`Bookmark not found: ${bookmarkId}`);
  }

  const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

  const exportedBookmark = formatBookmarkForExport(bookmark, markdown, qaPairs);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarkCount: 1,
    bookmarks: [exportedBookmark],
  };
}

/**
 * Export all bookmarks with their related data
 */
export async function exportAllBookmarks(): Promise<BookmarkExport> {
  const bookmarks = await db.bookmarks.orderBy('createdAt').reverse().toArray();

  const exportedBookmarks: ExportedBookmark[] = [];

  for (const bookmark of bookmarks) {
    const markdown = await db.markdown.where('bookmarkId').equals(bookmark.id).first();
    const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmark.id).toArray();
    exportedBookmarks.push(formatBookmarkForExport(bookmark, markdown, qaPairs));
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarkCount: exportedBookmarks.length,
    bookmarks: exportedBookmarks,
  };
}

/**
 * Format a bookmark for export (strips embeddings and HTML to reduce file size)
 */
function formatBookmarkForExport(
  bookmark: Bookmark,
  markdown: Markdown | undefined,
  qaPairs: QuestionAnswer[]
): ExportedBookmark {
  return {
    id: bookmark.id,
    url: bookmark.url,
    title: bookmark.title,
    status: bookmark.status,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
    markdown: markdown?.content,
    questionsAnswers: qaPairs.map(qa => ({
      question: qa.question,
      answer: qa.answer,
    })),
  };
}

/**
 * Trigger a download of the export data as a JSON file
 */
export function downloadExport(data: BookmarkExport, filename?: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const defaultFilename = data.bookmarkCount === 1
    ? `bookmark-${sanitizeFilename(data.bookmarks[0].title)}-${formatDateForFilename(new Date())}.json`
    : `bookmarks-export-${formatDateForFilename(new Date())}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a string for use in a filename
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Format a date for use in a filename
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Validate import data structure
 */
export function validateImportData(data: unknown): data is BookmarkExport {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') return false;
  if (!Array.isArray(obj.bookmarks)) return false;

  for (const bookmark of obj.bookmarks) {
    if (!bookmark || typeof bookmark !== 'object') return false;
    const b = bookmark as Record<string, unknown>;
    if (typeof b.url !== 'string' || typeof b.title !== 'string') return false;
  }

  return true;
}

/**
 * Import bookmarks from export data
 * Skips bookmarks that already exist (by URL)
 */
export async function importBookmarks(data: BookmarkExport): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  // Get existing URLs to avoid duplicates
  const existingBookmarks = await db.bookmarks.toArray();
  const existingUrls = new Set(existingBookmarks.map(b => b.url));

  for (const exportedBookmark of data.bookmarks) {
    try {
      // Skip if URL already exists
      if (existingUrls.has(exportedBookmark.url)) {
        result.skipped++;
        continue;
      }

      const now = new Date();
      const bookmarkId = crypto.randomUUID();

      // Create the bookmark record
      // Note: We don't have the original HTML, so imported bookmarks
      // will have their markdown but can't be reprocessed
      const bookmark: Bookmark = {
        id: bookmarkId,
        url: exportedBookmark.url,
        title: exportedBookmark.title,
        html: '', // No HTML available from export
        status: exportedBookmark.markdown ? 'complete' : 'pending',
        createdAt: exportedBookmark.createdAt ? new Date(exportedBookmark.createdAt) : now,
        updatedAt: now,
      };

      await db.bookmarks.add(bookmark);

      // Add markdown if available
      if (exportedBookmark.markdown) {
        const markdown: Markdown = {
          id: crypto.randomUUID(),
          bookmarkId,
          content: exportedBookmark.markdown,
          createdAt: now,
          updatedAt: now,
        };
        await db.markdown.add(markdown);
      }

      // Note: Q&A pairs are imported without embeddings
      // They would need to be regenerated for semantic search
      // For now, we skip importing Q&A pairs since they're not searchable without embeddings

      result.imported++;
      existingUrls.add(exportedBookmark.url); // Track to avoid duplicates within import
    } catch (error) {
      result.errors.push(`Failed to import "${exportedBookmark.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (result.errors.length > 0) {
    result.success = result.imported > 0; // Partial success if some imported
  }

  return result;
}

/**
 * Read and parse a JSON file for import
 */
export function readImportFile(file: File): Promise<BookmarkExport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        if (!validateImportData(data)) {
          reject(new Error('Invalid bookmark export file format'));
          return;
        }

        resolve(data);
      } catch (error) {
        reject(new Error('Failed to parse JSON file'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
