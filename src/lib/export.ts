import { db, Bookmark, Markdown, QuestionAnswer, JobType, JobStatus } from '../db/schema';
import { createJob, updateJob, completeJob, failJob } from './jobs';
import { encodeEmbedding, decodeEmbedding, isEncodedEmbedding } from './embedding-codec';

// Export format version for future compatibility
// v1: Original format with raw number[] embeddings
// v2: Embeddings encoded as base64 strings (16-bit quantized)
const EXPORT_VERSION = 2;

export interface ExportedBookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  status: Bookmark['status'];
  createdAt: string;
  updatedAt: string;
  markdown?: string;
  questionsAnswers: Array<{
    question: string;
    answer: string;
    // v2 format: base64 encoded embeddings (16-bit quantized)
    embeddingQuestion?: string;
    embeddingAnswer?: string;
    embeddingBoth?: string;
  }>;
}

// Legacy v1 format interface for backward compatibility during import
interface LegacyExportedQA {
  question: string;
  answer: string;
  embeddingQuestion?: number[];
  embeddingAnswer?: number[];
  embeddingBoth?: number[];
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
 * Format a bookmark for export (includes embeddings for full backup)
 * Embeddings are encoded as base64 strings for ~7x size reduction
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
    html: bookmark.html,
    status: bookmark.status,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
    markdown: markdown?.content,
    questionsAnswers: qaPairs.map(qa => ({
      question: qa.question,
      answer: qa.answer,
      // Encode embeddings as base64 for compact storage
      embeddingQuestion: qa.embeddingQuestion ? encodeEmbedding(qa.embeddingQuestion) : undefined,
      embeddingAnswer: qa.embeddingAnswer ? encodeEmbedding(qa.embeddingAnswer) : undefined,
      embeddingBoth: qa.embeddingBoth ? encodeEmbedding(qa.embeddingBoth) : undefined,
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

/**
 * Decode an embedding field from import data
 * Supports both v1 format (number[]) and v2 format (base64 string)
 */
function decodeEmbeddingField(value: unknown): number[] | null {
  // v2 format: base64 encoded string
  if (isEncodedEmbedding(value)) {
    try {
      return decodeEmbedding(value);
    } catch {
      return null;
    }
  }

  // v1 format: raw number array
  if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
    return value;
  }

  return null;
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
export async function importBookmarks(data: BookmarkExport, fileName?: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  // Create FILE_IMPORT job
  const job = await createJob({
    type: JobType.FILE_IMPORT,
    status: JobStatus.IN_PROGRESS,
    progress: 0,
    metadata: {
      fileName: fileName || 'bookmarks-export.json',
      totalBookmarks: data.bookmarks.length,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
    },
  });

  try {
    // Get existing URLs to avoid duplicates
    const existingBookmarks = await db.bookmarks.toArray();
    const existingUrls = new Set(existingBookmarks.map(b => b.url));

    for (let i = 0; i < data.bookmarks.length; i++) {
      const exportedBookmark = data.bookmarks[i];

      try {
        // Skip if URL already exists
        if (existingUrls.has(exportedBookmark.url)) {
          result.skipped++;
          continue;
        }

        const now = new Date();
        const bookmarkId = crypto.randomUUID();

        // Determine status: if we have HTML, can reprocess; otherwise use exported status
        const hasHtml = exportedBookmark.html && exportedBookmark.html.length > 0;
        let status: Bookmark['status'] = exportedBookmark.status;
        // If no HTML and no markdown, mark as pending (though won't be processable)
        if (!hasHtml && !exportedBookmark.markdown) {
          status = 'pending';
        }

        const bookmark: Bookmark = {
          id: bookmarkId,
          url: exportedBookmark.url,
          title: exportedBookmark.title,
          html: exportedBookmark.html || '',
          status,
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

        // Add Q&A pairs with embeddings if available
        if (exportedBookmark.questionsAnswers && exportedBookmark.questionsAnswers.length > 0) {
          for (const qa of exportedBookmark.questionsAnswers) {
            // Only import if we have embeddings (otherwise they won't be searchable)
            if (qa.embeddingQuestion && qa.embeddingAnswer && qa.embeddingBoth) {
              // Decode embeddings - support both v1 (number[]) and v2 (base64 string) formats
              const embeddingQuestion = decodeEmbeddingField(qa.embeddingQuestion);
              const embeddingAnswer = decodeEmbeddingField(qa.embeddingAnswer);
              const embeddingBoth = decodeEmbeddingField(qa.embeddingBoth);

              if (embeddingQuestion && embeddingAnswer && embeddingBoth) {
                const questionAnswer: QuestionAnswer = {
                  id: crypto.randomUUID(),
                  bookmarkId,
                  question: qa.question,
                  answer: qa.answer,
                  embeddingQuestion,
                  embeddingAnswer,
                  embeddingBoth,
                  createdAt: now,
                  updatedAt: now,
                };
                await db.questionsAnswers.add(questionAnswer);
              }
            }
          }
        }

        result.imported++;
        existingUrls.add(exportedBookmark.url); // Track to avoid duplicates within import

        // Update job progress
        const progress = Math.round(((i + 1) / data.bookmarks.length) * 100);
        await updateJob(job.id, {
          progress,
          metadata: {
            importedCount: result.imported,
            skippedCount: result.skipped,
            errorCount: result.errors.length,
          },
        });
      } catch (error) {
        const errorMsg = `Failed to import "${exportedBookmark.title}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
      }
    }

    if (result.errors.length > 0) {
      result.success = result.imported > 0; // Partial success if some imported
    }

    // Complete job
    await completeJob(job.id, {
      fileName: fileName || 'bookmarks-export.json',
      totalBookmarks: data.bookmarks.length,
      importedCount: result.imported,
      skippedCount: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 10).map(err => ({ url: '', error: err })), // Limit to 10 errors
    });

    return result;
  } catch (error) {
    // Mark job as failed
    await failJob(job.id, error instanceof Error ? error : String(error));
    throw error;
  }
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
