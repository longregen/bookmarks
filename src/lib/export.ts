import { db, type Bookmark, type Markdown, type QuestionAnswer, JobType, JobStatus, getBookmarkContent } from '../db/schema';
import { createJob } from './jobs';
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
  questionsAnswers: {
    question: string;
    answer: string;
    embeddingQuestion?: string;
    embeddingAnswer?: string;
    embeddingBoth?: string;
  }[];
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

  // Batch load all related data to avoid N+1 queries
  const bookmarkIds = bookmarks.map(b => b.id);
  const [allMarkdown, allQAPairs] = await Promise.all([
    db.markdown.where('bookmarkId').anyOf(bookmarkIds).toArray(),
    db.questionsAnswers.where('bookmarkId').anyOf(bookmarkIds).toArray(),
  ]);

  // Build lookup maps for O(1) access
  const markdownByBookmarkId = new Map(allMarkdown.map(m => [m.bookmarkId, m]));
  const qaPairsByBookmarkId = new Map<string, QuestionAnswer[]>();
  for (const qa of allQAPairs) {
    const existing = qaPairsByBookmarkId.get(qa.bookmarkId) ?? [];
    existing.push(qa);
    qaPairsByBookmarkId.set(qa.bookmarkId, existing);
  }

  const exportedBookmarks: ExportedBookmark[] = bookmarks.map(bookmark => {
    const markdown = markdownByBookmarkId.get(bookmark.id);
    const qaPairs = qaPairsByBookmarkId.get(bookmark.id) ?? [];
    return formatBookmarkForExport(bookmark, markdown, qaPairs);
  });

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
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    questionsAnswers: qaPairs.map(qa => ({
      question: qa.question,
      answer: qa.answer,
      embeddingQuestion: qa.embeddingQuestion !== undefined ? encodeEmbedding(qa.embeddingQuestion) : undefined,
      embeddingAnswer: qa.embeddingAnswer !== undefined ? encodeEmbedding(qa.embeddingAnswer) : undefined,
      embeddingBoth: qa.embeddingBoth !== undefined ? encodeEmbedding(qa.embeddingBoth) : undefined,
    })),
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  };
}


function decodeEmbeddingField(value: unknown): number[] | null {
  if (isEncodedEmbedding(value)) {
    try {
      return decodeEmbedding(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'number')) {
    return value;
  }
  return null;
}

async function importSingleBookmark(exportedBookmark: ExportedBookmark): Promise<string> {
  const now = new Date();
  const bookmarkId = crypto.randomUUID();
  const hasHtml = Boolean(exportedBookmark.html) && exportedBookmark.html.length > 0;
  let status: Bookmark['status'] = exportedBookmark.status;
  const hasMarkdown = exportedBookmark.markdown !== undefined && exportedBookmark.markdown !== '';
  if (!hasHtml && !hasMarkdown) {
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
  if (questionsAnswers.length === 0) {
    return;
  }

  const now = new Date();
  const qaPairsToAdd: QuestionAnswer[] = [];

  for (const qa of questionsAnswers) {
    const hasQuestion = qa.embeddingQuestion !== undefined && qa.embeddingQuestion !== '';
    const hasAnswer = qa.embeddingAnswer !== undefined && qa.embeddingAnswer !== '';
    const hasBoth = qa.embeddingBoth !== undefined && qa.embeddingBoth !== '';
    if (hasQuestion && hasAnswer && hasBoth) {
      const embeddingQuestion = decodeEmbeddingField(qa.embeddingQuestion);
      const embeddingAnswer = decodeEmbeddingField(qa.embeddingAnswer);
      const embeddingBoth = decodeEmbeddingField(qa.embeddingBoth);

      if (embeddingQuestion !== null && embeddingAnswer !== null && embeddingBoth !== null) {
        qaPairsToAdd.push({
          id: crypto.randomUUID(),
          bookmarkId,
          question: qa.question,
          answer: qa.answer,
          embeddingQuestion,
          embeddingAnswer,
          embeddingBoth,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  if (qaPairsToAdd.length > 0) {
    await db.questionsAnswers.bulkAdd(qaPairsToAdd);
  }
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

export function validateImportData(data: unknown): data is BookmarkExport {
  if (data === null || data === undefined || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') return false;
  if (!Array.isArray(obj.bookmarks)) return false;

  for (const bookmark of obj.bookmarks) {
    if (bookmark === null || bookmark === undefined || typeof bookmark !== 'object') return false;
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

  try {
    const existingBookmarks = await db.bookmarks.toArray();
    const existingUrls = new Set(existingBookmarks.map(b => b.url));

    for (const exportedBookmark of data.bookmarks) {
      try {
        if (existingUrls.has(exportedBookmark.url)) {
          result.skipped++;
          continue;
        }

        const bookmarkId = await importSingleBookmark(exportedBookmark);

        // Parallelize markdown and QA pairs import since they don't depend on each other
        const importTasks = [];
        if (exportedBookmark.markdown !== undefined && exportedBookmark.markdown !== '') {
          importTasks.push(importMarkdown(bookmarkId, exportedBookmark.markdown));
        }
        importTasks.push(importQAPairs(bookmarkId, exportedBookmark.questionsAnswers));
        await Promise.all(importTasks);

        result.imported++;
        existingUrls.add(exportedBookmark.url);
      } catch (error) {
        const errorMsg = `Failed to import "${exportedBookmark.title}": ${getErrorMessage(error)}`;
        result.errors.push(errorMsg);
      }
    }

    if (result.errors.length > 0) {
      result.success = result.imported > 0;
    }

    // Create completed job log entry
    await createJob({
      type: JobType.FILE_IMPORT,
      status: JobStatus.COMPLETED,
      metadata: {
        fileName: fileName ?? 'bookmarks-export.json',
        importedCount: result.imported,
        skippedCount: result.skipped,
      },
    });

    return result;
  } catch (error) {
    // Create failed job log entry
    await createJob({
      type: JobType.FILE_IMPORT,
      status: JobStatus.FAILED,
      metadata: {
        fileName: fileName ?? 'bookmarks-export.json',
        errorMessage: getErrorMessage(error),
      },
    });
    throw error;
  }
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
