import { db, Bookmark, Markdown, QuestionAnswer, JobType, JobStatus, getBookmarkContent } from '../db/schema';
import { createJob, updateJob, completeJob, failJob } from './jobs';
import { encodeEmbedding, decodeEmbedding, isEncodedEmbedding } from './embedding-codec';
import { getErrorMessage } from './errors';

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
    embeddingQuestion?: string;
    embeddingAnswer?: string;
    embeddingBoth?: string;
  }>;
}

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

export async function exportSingleBookmark(bookmarkId: string): Promise<BookmarkExport> {
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) {
    throw new Error(`Bookmark not found: ${bookmarkId}`);
  }

  const { markdown, qaPairs } = await getBookmarkContent(bookmarkId);

  const exportedBookmark = formatBookmarkForExport(bookmark, markdown, qaPairs);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarkCount: 1,
    bookmarks: [exportedBookmark],
  };
}

export async function exportAllBookmarks(): Promise<BookmarkExport> {
  const bookmarks = await db.bookmarks.orderBy('createdAt').reverse().toArray();

  const exportedBookmarks: ExportedBookmark[] = [];

  for (const bookmark of bookmarks) {
    const { markdown, qaPairs } = await getBookmarkContent(bookmark.id);
    exportedBookmarks.push(formatBookmarkForExport(bookmark, markdown, qaPairs));
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarkCount: exportedBookmarks.length,
    bookmarks: exportedBookmarks,
  };
}

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
      embeddingQuestion: qa.embeddingQuestion ? encodeEmbedding(qa.embeddingQuestion) : undefined,
      embeddingAnswer: qa.embeddingAnswer ? encodeEmbedding(qa.embeddingAnswer) : undefined,
      embeddingBoth: qa.embeddingBoth ? encodeEmbedding(qa.embeddingBoth) : undefined,
    })),
  };
}

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

function decodeEmbeddingField(value: unknown): number[] | null {
  if (isEncodedEmbedding(value)) {
    try {
      return decodeEmbedding(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.every(v => typeof v === 'number')) {
    return value;
  }
  return null;
}

async function importSingleBookmark(exportedBookmark: ExportedBookmark): Promise<string> {
  const now = new Date();
  const bookmarkId = crypto.randomUUID();
  const hasHtml = exportedBookmark.html && exportedBookmark.html.length > 0;
  let status: Bookmark['status'] = exportedBookmark.status;
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
  return bookmarkId;
}

async function importMarkdown(bookmarkId: string, content: string): Promise<void> {
  const now = new Date();
  const markdown: Markdown = {
    id: crypto.randomUUID(),
    bookmarkId,
    content,
    createdAt: now,
    updatedAt: now,
  };
  await db.markdown.add(markdown);
}

async function importQAPairs(
  bookmarkId: string,
  questionsAnswers: ExportedBookmark['questionsAnswers']
): Promise<void> {
  if (!questionsAnswers || questionsAnswers.length === 0) {
    return;
  }

  const now = new Date();
  for (const qa of questionsAnswers) {
    if (qa.embeddingQuestion && qa.embeddingAnswer && qa.embeddingBoth) {
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

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

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
    const existingBookmarks = await db.bookmarks.toArray();
    const existingUrls = new Set(existingBookmarks.map(b => b.url));

    for (let i = 0; i < data.bookmarks.length; i++) {
      const exportedBookmark = data.bookmarks[i];

      try {
        if (existingUrls.has(exportedBookmark.url)) {
          result.skipped++;
          continue;
        }

        const bookmarkId = await importSingleBookmark(exportedBookmark);

        if (exportedBookmark.markdown) {
          await importMarkdown(bookmarkId, exportedBookmark.markdown);
        }

        await importQAPairs(bookmarkId, exportedBookmark.questionsAnswers || []);

        result.imported++;
        existingUrls.add(exportedBookmark.url);

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
        const errorMsg = `Failed to import "${exportedBookmark.title}": ${getErrorMessage(error)}`;
        result.errors.push(errorMsg);
      }
    }

    if (result.errors.length > 0) {
      result.success = result.imported > 0;
    }

    await completeJob(job.id, {
      fileName: fileName || 'bookmarks-export.json',
      totalBookmarks: data.bookmarks.length,
      importedCount: result.imported,
      skippedCount: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 10).map(err => ({ url: '', error: err })),
    });

    return result;
  } catch (error) {
    await failJob(job.id, getErrorMessage(error));
    throw error;
  }
}

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
