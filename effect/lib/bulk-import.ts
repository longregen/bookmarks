import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type { Bookmark, JobStatus, JobType } from '../../src/db/schema';
import { validateWebUrl } from '../../src/lib/url-validator';

// ============================================================================
// Types
// ============================================================================

export interface UrlValidation {
  original: string;
  normalized: string;
  isValid: boolean;
  error?: string;
}

export interface ValidationResult {
  validUrls: string[];
  invalidUrls: UrlValidation[];
  duplicates: string[];
}

// ============================================================================
// Errors
// ============================================================================

export class BulkImportError extends Data.TaggedError('BulkImportError')<{
  reason: 'validation_failed' | 'storage_failed' | 'job_creation_failed';
  message: string;
  cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

export class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    getBookmarksByUrls(
      urls: string[]
    ): Effect.Effect<Bookmark[], BulkImportError, never>;
    bulkAddBookmarks(
      bookmarks: Bookmark[]
    ): Effect.Effect<void, BulkImportError, never>;
    bulkUpdateBookmarks(
      bookmarks: Bookmark[]
    ): Effect.Effect<void, BulkImportError, never>;
  }
>() {}

export class JobQueueService extends Context.Tag('JobQueueService')<
  JobQueueService,
  {
    createJob(params: {
      type: JobType;
      status: JobStatus;
      metadata: Record<string, unknown>;
    }): Effect.Effect<{ id: string }, BulkImportError, never>;
    createJobItems(
      jobId: string,
      bookmarkIds: string[]
    ): Effect.Effect<void, BulkImportError, never>;
  }
>() {}

// ============================================================================
// Pure Functions
// ============================================================================

export function validateUrls(urlsText: string): ValidationResult {
  const lines = urlsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const validUrls: string[] = [];
  const invalidUrls: UrlValidation[] = [];
  const seenUrls = new Set<string>();
  const duplicates: string[] = [];

  for (const line of lines) {
    const validation = validateSingleUrl(line);

    if (!validation.isValid) {
      invalidUrls.push(validation);
      continue;
    }

    if (seenUrls.has(validation.normalized)) {
      duplicates.push(validation.normalized);
      continue;
    }

    validUrls.push(validation.normalized);
    seenUrls.add(validation.normalized);
  }

  return {
    validUrls,
    invalidUrls,
    duplicates,
  };
}

export function validateSingleUrl(url: string): UrlValidation {
  const result = validateWebUrl(url);

  return {
    original: url,
    normalized: result.normalizedUrl ?? '',
    isValid: result.valid,
    error: result.error,
  };
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&amp;': '&',
  };
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-z]+));/gi,
    (match, dec?: string, hex?: string, named?: string) => {
      if (dec !== undefined) return String.fromCharCode(parseInt(dec, 10));
      if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
      if (named !== undefined) return entities[`&${named};`] ?? match;
      return match;
    }
  );
}

export function extractTitleFromHtml(html: string): string {
  const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
  if (titleMatch?.[1] !== undefined) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}

// ============================================================================
// Effect Functions
// ============================================================================

export function createBulkImportJob(
  urls: string[]
): Effect.Effect<string, BulkImportError, BookmarkRepository | JobQueueService> {
  return Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const jobQueue = yield* JobQueueService;

    const now = yield* Effect.sync(() => new Date());
    const bookmarkIds: string[] = [];

    // Load all existing bookmarks for the given URLs in one query
    const existingBookmarks = yield* bookmarkRepo.getBookmarksByUrls(urls);
    const existingByUrl = yield* Effect.sync(() =>
      new Map(existingBookmarks.map((b) => [b.url, b]))
    );

    // Separate new URLs from existing ones
    const newBookmarks: Bookmark[] = [];
    const updatedBookmarks: Bookmark[] = [];

    for (const url of urls) {
      const existing = existingByUrl.get(url);
      if (!existing) {
        const id = yield* Effect.sync(() => crypto.randomUUID());
        newBookmarks.push({
          id,
          url,
          title: url,
          html: '',
          status: 'fetching' as const,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        bookmarkIds.push(id);
      } else {
        // Reset existing bookmark to be re-fetched
        updatedBookmarks.push({
          ...existing,
          status: 'fetching' as const,
          html: '',
          errorMessage: undefined,
          retryCount: 0,
          updatedAt: now,
        });
        bookmarkIds.push(existing.id);
      }
    }

    // Use bulk operations for better performance
    if (newBookmarks.length > 0) {
      yield* bookmarkRepo.bulkAddBookmarks(newBookmarks);
    }
    if (updatedBookmarks.length > 0) {
      yield* bookmarkRepo.bulkUpdateBookmarks(updatedBookmarks);
    }

    // Create job with IN_PROGRESS status (will be updated as items complete)
    const job = yield* jobQueue.createJob({
      type: 'BULK_URL_IMPORT' as JobType,
      status: 'IN_PROGRESS' as JobStatus,
      metadata: {
        totalUrls: urls.length,
      },
    });

    // Create job items for each bookmark
    yield* jobQueue.createJobItems(job.id, bookmarkIds);

    return job.id;
  });
}
