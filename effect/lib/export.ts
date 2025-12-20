import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type { Bookmark, Markdown, QuestionAnswer } from '../../src/db/schema';
import { JobType, JobStatus } from '../../src/db/schema';
import { encodeEmbedding, decodeEmbedding, isEncodedEmbedding } from '../../src/lib/embedding-codec';

const EXPORT_VERSION = 2;

// ============================================================================
// Types
// ============================================================================

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

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// Errors
// ============================================================================

export class BookmarkNotFoundError extends Data.TaggedError('BookmarkNotFoundError')<{
  readonly bookmarkId: string;
}> {}

export class InvalidImportDataError extends Data.TaggedError('InvalidImportDataError')<{
  readonly reason: string;
}> {}

export class ImportError extends Data.TaggedError('ImportError')<{
  readonly bookmarkTitle: string;
  readonly message: string;
}> {}

export class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly fileName: string;
  readonly message: string;
}> {}

export class ExportError extends Data.TaggedError('ExportError')<{
  readonly operation: string;
  readonly message: string;
}> {}

// ============================================================================
// Services
// ============================================================================

export class StorageService extends Context.Tag('ExportStorageService')<
  StorageService,
  {
    readonly getBookmark: (id: string) => Effect.Effect<Bookmark | null, ExportError>;
    readonly addBookmark: (bookmark: Bookmark) => Effect.Effect<void, ExportError>;
    readonly getAllBookmarks: () => Effect.Effect<Bookmark[], ExportError>;
    readonly getBookmarksArray: () => Effect.Effect<Bookmark[], ExportError>;

    readonly getMarkdown: (bookmarkId: string) => Effect.Effect<Markdown | undefined, ExportError>;
    readonly addMarkdown: (markdown: Markdown) => Effect.Effect<void, ExportError>;
    readonly getMarkdownByBookmarkIds: (bookmarkIds: string[]) => Effect.Effect<Markdown[], ExportError>;

    readonly getQAPairs: (bookmarkId: string) => Effect.Effect<QuestionAnswer[], ExportError>;
    readonly bulkAddQAPairs: (qaPairs: QuestionAnswer[]) => Effect.Effect<void, ExportError>;
    readonly getQAPairsByBookmarkIds: (bookmarkIds: string[]) => Effect.Effect<QuestionAnswer[], ExportError>;
  }
>() {}

export class JobService extends Context.Tag('ExportJobService')<
  JobService,
  {
    readonly createJob: (params: {
      type: JobType;
      status: JobStatus;
      metadata?: Record<string, unknown>;
    }) => Effect.Effect<void, ExportError>;
  }
>() {}

// ============================================================================
// Helper Functions (Pure)
// ============================================================================

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

// ============================================================================
// Core Effects
// ============================================================================

function getBookmarkContentEffect(
  bookmarkId: string
): Effect.Effect<
  { markdown: Markdown | undefined; qaPairs: QuestionAnswer[] },
  ExportError,
  StorageService
> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;

    const markdown = yield* storage.getMarkdown(bookmarkId);
    const qaPairs = yield* storage.getQAPairs(bookmarkId);

    return { markdown, qaPairs };
  });
}

export function exportSingleBookmark(
  bookmarkId: string
): Effect.Effect<BookmarkExport, BookmarkNotFoundError | ExportError, StorageService> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;

    const bookmark = yield* storage.getBookmark(bookmarkId);

    if (!bookmark) {
      return yield* Effect.fail(new BookmarkNotFoundError({ bookmarkId }));
    }

    const { markdown, qaPairs } = yield* getBookmarkContentEffect(bookmarkId);
    const exportedBookmark = formatBookmarkForExport(bookmark, markdown, qaPairs);

    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      bookmarkCount: 1,
      bookmarks: [exportedBookmark],
    };
  });
}

export function exportAllBookmarks(): Effect.Effect<
  BookmarkExport,
  ExportError,
  StorageService
> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;

    const bookmarks = yield* storage.getBookmarksArray();

    // Batch load all related data to avoid N+1 queries
    const bookmarkIds = bookmarks.map(b => b.id);
    const allMarkdown = yield* storage.getMarkdownByBookmarkIds(bookmarkIds);
    const allQAPairs = yield* storage.getQAPairsByBookmarkIds(bookmarkIds);

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
  });
}

function importSingleBookmarkEffect(
  exportedBookmark: ExportedBookmark
): Effect.Effect<string, ExportError, StorageService> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;

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

    yield* storage.addBookmark(bookmark);
    return bookmarkId;
  });
}

function importMarkdownEffect(
  bookmarkId: string,
  content: string
): Effect.Effect<void, ExportError, StorageService> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;
    const now = new Date();

    const markdown: Markdown = {
      id: crypto.randomUUID(),
      bookmarkId,
      content,
      createdAt: now,
      updatedAt: now,
    };

    yield* storage.addMarkdown(markdown);
  });
}

function importQAPairsEffect(
  bookmarkId: string,
  questionsAnswers: ExportedBookmark['questionsAnswers']
): Effect.Effect<void, ExportError, StorageService> {
  return Effect.gen(function* () {
    if (questionsAnswers.length === 0) {
      return;
    }

    const storage = yield* StorageService;
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
      yield* storage.bulkAddQAPairs(qaPairsToAdd);
    }
  });
}

export function importBookmarks(
  data: BookmarkExport,
  fileName?: string
): Effect.Effect<ImportResult, ExportError, StorageService | JobService> {
  return Effect.gen(function* () {
    const storage = yield* StorageService;
    const jobService = yield* JobService;

    const result: ImportResult = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: [],
    };

    const existingBookmarks = yield* storage.getAllBookmarks();
    const existingUrls = new Set(existingBookmarks.map(b => b.url));

    for (const exportedBookmark of data.bookmarks) {
      if (existingUrls.has(exportedBookmark.url)) {
        result.skipped++;
        continue;
      }

      const importResult = yield* Effect.gen(function* () {
        const bookmarkId = yield* importSingleBookmarkEffect(exportedBookmark);

        // Parallelize markdown and QA pairs import since they don't depend on each other
        const importTasks = [];

        if (exportedBookmark.markdown !== undefined && exportedBookmark.markdown !== '') {
          importTasks.push(importMarkdownEffect(bookmarkId, exportedBookmark.markdown));
        }
        importTasks.push(importQAPairsEffect(bookmarkId, exportedBookmark.questionsAnswers));

        yield* Effect.all(importTasks, { concurrency: 'unbounded' });

        return bookmarkId;
      }).pipe(
        Effect.catchAll((error) => {
          const errorMsg = `Failed to import "${exportedBookmark.title}": ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          return Effect.succeed(null);
        })
      );

      if (importResult !== null) {
        result.imported++;
        existingUrls.add(exportedBookmark.url);
      }
    }

    if (result.errors.length > 0) {
      result.success = result.imported > 0;
    }

    // Create completed job log entry
    yield* jobService.createJob({
      type: JobType.FILE_IMPORT,
      status: JobStatus.COMPLETED,
      metadata: {
        fileName: fileName ?? 'bookmarks-export.json',
        importedCount: result.imported,
        skippedCount: result.skipped,
      },
    });

    return result;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const jobService = yield* JobService;

        // Create failed job log entry
        yield* jobService.createJob({
          type: JobType.FILE_IMPORT,
          status: JobStatus.FAILED,
          metadata: {
            fileName: fileName ?? 'bookmarks-export.json',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });

        return yield* Effect.fail(error);
      })
    )
  );
}

export function readImportFile(
  file: File
): Effect.Effect<BookmarkExport, InvalidImportDataError | FileReadError> {
  return Effect.tryPromise({
    try: () =>
      new Promise<BookmarkExport>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
          try {
            const text = e.target?.result as string;
            const data = JSON.parse(text) as unknown;

            if (!validateImportData(data)) {
              reject(new InvalidImportDataError({ reason: 'Invalid bookmark export file format' }));
              return;
            }

            resolve(data);
          } catch {
            reject(new InvalidImportDataError({ reason: 'Failed to parse JSON file' }));
          }
        };

        reader.onerror = () => reject(new FileReadError({
          fileName: file.name,
          message: 'Failed to read file'
        }));

        reader.readAsText(file);
      }),
    catch: (error) => {
      if (error instanceof InvalidImportDataError || error instanceof FileReadError) {
        return error;
      }
      return new FileReadError({
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
