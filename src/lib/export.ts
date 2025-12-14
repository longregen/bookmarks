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
