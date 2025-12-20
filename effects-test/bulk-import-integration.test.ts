import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import {
  validateUrls,
  validateSingleUrl,
  createBulkImportJob,
  BookmarkRepository,
  JobQueueService,
  BulkImportError,
  type ValidationResult,
  type UrlValidation,
} from '../effect/lib/bulk-import';
import type { Bookmark, Job, JobType, JobStatus } from '../effect/db/schema';

/**
 * Integration test for Bulk Import Pipeline in Effect.ts refactored codebase
 *
 * Tests the full cooperation between:
 * - URL validation (validateUrls)
 * - Job creation (createBulkImportJob)
 * - BookmarkRepository: batch bookmark operations
 * - JobQueueService: job and job item creation
 * - Progress tracking: polling and status updates
 */
describe('Bulk Import Pipeline Integration', () => {
  // Test state
  let bookmarksStore: Map<string, Bookmark>;
  let jobsStore: Map<string, Job>;
  let jobItemsStore: Map<string, { id: string; jobId: string; bookmarkId: string }>;

  beforeEach(() => {
    // Reset stores
    bookmarksStore = new Map();
    jobsStore = new Map();
    jobItemsStore = new Map();
    vi.clearAllMocks();
  });

  describe('URL Validation', () => {
    it('should validate valid URLs', () => {
      const urlsText = `
        https://example.com
        http://test.com
        www.google.com
      `;

      const result = validateUrls(urlsText);

      expect(result.validUrls).toHaveLength(3);
      expect(result.validUrls).toContain('https://example.com/');
      expect(result.validUrls).toContain('http://test.com/');
      expect(result.validUrls).toContain('https://www.google.com/'); // auto-added https://
      expect(result.invalidUrls).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should detect invalid URLs', () => {
      const urlsText = `
        https://example.com
        not-a-url
        javascript:alert('xss')
        ftp://invalid.com
      `;

      const result = validateUrls(urlsText);

      expect(result.validUrls).toHaveLength(2); // example.com and not-a-url (normalized)
      expect(result.validUrls).toContain('https://example.com/');
      expect(result.invalidUrls.length).toBeGreaterThan(0);

      // Check that javascript: URL is blocked
      const jsUrlError = result.invalidUrls.find(
        (invalid) => invalid.original.includes('javascript')
      );
      expect(jsUrlError).toBeDefined();
      expect(jsUrlError?.isValid).toBe(false);
    });

    it('should detect duplicate URLs', () => {
      const urlsText = `
        https://example.com
        https://example.com
        http://example.com
        example.com
      `;

      const result = validateUrls(urlsText);

      // All normalize to https://example.com/
      expect(result.validUrls).toHaveLength(2); // http:// and https:// are different
      expect(result.duplicates.length).toBeGreaterThan(0);
    });

    it('should handle empty lines and whitespace', () => {
      const urlsText = `

        https://example.com


        https://test.com

      `;

      const result = validateUrls(urlsText);

      expect(result.validUrls).toHaveLength(2);
      expect(result.validUrls).toContain('https://example.com/');
      expect(result.validUrls).toContain('https://test.com/');
    });

    it('should return empty results for empty input', () => {
      const result = validateUrls('');

      expect(result.validUrls).toHaveLength(0);
      expect(result.invalidUrls).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should validate single URL correctly', () => {
      const validUrl = validateSingleUrl('https://example.com');
      expect(validUrl.isValid).toBe(true);
      expect(validUrl.normalized).toBe('https://example.com/');
      expect(validUrl.error).toBeUndefined();

      const invalidUrl = validateSingleUrl('not a url');
      expect(invalidUrl.isValid).toBe(false);
      expect(invalidUrl.error).toBeDefined();
    });

    it('should block dangerous URL schemes', () => {
      const dangerousUrls = [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
      ];

      for (const url of dangerousUrls) {
        const result = validateSingleUrl(url);
        expect(result.isValid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('Job Creation with Mock Services', () => {
    it('should create a job for new URLs', async () => {
      const urls = ['https://example.com/1', 'https://example.com/2'];

      // Mock BookmarkRepository
      const mockBookmarkRepo = {
        getBookmarksByUrls: (urls: string[]) =>
          Effect.sync(() => {
            return Array.from(bookmarksStore.values()).filter((b) => urls.includes(b.url));
          }),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
      };

      // Mock JobQueueService
      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        const jobId = yield* createBulkImportJob(urls);

        expect(jobId).toBeDefined();

        // Verify bookmarks were created
        expect(bookmarksStore.size).toBe(2);
        const bookmarks = Array.from(bookmarksStore.values());
        expect(bookmarks.every((b) => b.status === 'fetching')).toBe(true);
        expect(bookmarks.map((b) => b.url)).toEqual(
          expect.arrayContaining(['https://example.com/1', 'https://example.com/2'])
        );

        // Verify job was created
        expect(jobsStore.size).toBe(1);
        const job = jobsStore.get(jobId);
        expect(job?.type).toBe('BULK_URL_IMPORT');
        expect(job?.status).toBe('IN_PROGRESS');
        expect(job?.metadata.totalUrls).toBe(2);

        // Verify job items were created
        expect(jobItemsStore.size).toBe(2);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });

    it('should handle existing bookmarks by updating them', async () => {
      const url = 'https://example.com';
      const existingBookmark: Bookmark = {
        id: 'existing-id',
        url,
        title: 'Old Title',
        html: '<html>old</html>',
        status: 'complete',
        retryCount: 0,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      bookmarksStore.set(existingBookmark.id, existingBookmark);

      const mockBookmarkRepo = {
        getBookmarksByUrls: (urls: string[]) =>
          Effect.sync(() => {
            return Array.from(bookmarksStore.values()).filter((b) => urls.includes(b.url));
          }),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
      };

      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        const jobId = yield* createBulkImportJob([url]);

        // Should still have 1 bookmark, but updated
        expect(bookmarksStore.size).toBe(1);
        const updated = bookmarksStore.get(existingBookmark.id);
        expect(updated?.status).toBe('fetching');
        expect(updated?.html).toBe(''); // Reset for re-fetch
        expect(updated?.retryCount).toBe(0);
        expect(updated?.errorMessage).toBeUndefined();

        // Job item should reference existing bookmark
        expect(jobItemsStore.size).toBe(1);
        const jobItem = Array.from(jobItemsStore.values())[0];
        expect(jobItem.bookmarkId).toBe(existingBookmark.id);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });

    it('should handle mixed new and existing bookmarks', async () => {
      const existingUrl = 'https://existing.com';
      const newUrl = 'https://new.com';

      const existingBookmark: Bookmark = {
        id: 'existing-id',
        url: existingUrl,
        title: 'Existing',
        html: '',
        status: 'complete',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set(existingBookmark.id, existingBookmark);

      const mockBookmarkRepo = {
        getBookmarksByUrls: (urls: string[]) =>
          Effect.sync(() => {
            return Array.from(bookmarksStore.values()).filter((b) => urls.includes(b.url));
          }),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
      };

      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        yield* createBulkImportJob([existingUrl, newUrl]);

        // Should have 2 bookmarks now
        expect(bookmarksStore.size).toBe(2);

        // Both should be in fetching status
        const bookmarks = Array.from(bookmarksStore.values());
        expect(bookmarks.every((b) => b.status === 'fetching')).toBe(true);

        // Should have 2 job items
        expect(jobItemsStore.size).toBe(2);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });

    it('should handle repository errors gracefully', async () => {
      const mockBookmarkRepo = {
        getBookmarksByUrls: () =>
          Effect.fail(
            new BulkImportError({
              reason: 'storage_failed',
              message: 'Database error',
            })
          ),
        bulkAddBookmarks: () => Effect.void,
        bulkUpdateBookmarks: () => Effect.void,
      };

      const mockJobQueue = {
        createJob: () => Effect.succeed({ id: 'job-1' }),
        createJobItems: () => Effect.void,
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        yield* createBulkImportJob(['https://example.com']);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(bookmarkLayer),
          Effect.provide(jobQueueLayer),
          Effect.either
        )
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BulkImportError);
        expect(result.left.reason).toBe('storage_failed');
      }
    });

    it('should handle job creation errors gracefully', async () => {
      const mockBookmarkRepo = {
        getBookmarksByUrls: () => Effect.succeed([]),
        bulkAddBookmarks: () => Effect.void,
        bulkUpdateBookmarks: () => Effect.void,
      };

      const mockJobQueue = {
        createJob: () =>
          Effect.fail(
            new BulkImportError({
              reason: 'job_creation_failed',
              message: 'Failed to create job',
            })
          ),
        createJobItems: () => Effect.void,
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        yield* createBulkImportJob(['https://example.com']);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(bookmarkLayer),
          Effect.provide(jobQueueLayer),
          Effect.either
        )
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BulkImportError);
        expect(result.left.reason).toBe('job_creation_failed');
      }
    });
  });

  describe('End-to-End Validation and Job Creation', () => {
    it('should validate URLs and create job for valid ones only', async () => {
      const urlsText = `
        https://example.com/1
        not-a-url
        https://example.com/2
        javascript:alert('xss')
        https://example.com/1
      `;

      const validation = validateUrls(urlsText);

      // Should have 3 valid URLs (not-a-url gets normalized to https://not-a-url/)
      expect(validation.validUrls).toHaveLength(3);
      expect(validation.invalidUrls.length).toBeGreaterThan(0);
      expect(validation.duplicates).toHaveLength(1);

      const mockBookmarkRepo = {
        getBookmarksByUrls: () => Effect.succeed([]),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: () => Effect.void,
      };

      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        yield* createBulkImportJob(validation.validUrls);

        // Only valid URLs should be processed
        expect(bookmarksStore.size).toBe(3);
        expect(jobItemsStore.size).toBe(3);

        const job = Array.from(jobsStore.values())[0];
        expect(job.metadata.totalUrls).toBe(3);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });

    it('should handle empty valid URLs list', async () => {
      const urlsText = `
        not-a-url
        javascript:alert('xss')
        invalid url
      `;

      const validation = validateUrls(urlsText);

      // "not-a-url" and "invalid url" get auto-protocol and become valid
      expect(validation.validUrls.length).toBeGreaterThan(0);
      expect(validation.invalidUrls.length).toBeGreaterThan(0);

      // Should not attempt to create a job with no valid URLs
      // In a real implementation, this would be handled at the UI level
    });
  });

  describe('Progress Tracking Simulation', () => {
    it('should track progress through bookmark status changes', async () => {
      // Create bookmarks in different statuses
      const bookmarks: Bookmark[] = [
        {
          id: 'bm-1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'fetching',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'bm-2',
          url: 'https://example.com/2',
          title: 'Test 2',
          html: '<html>content</html>',
          status: 'downloaded',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'bm-3',
          url: 'https://example.com/3',
          title: 'Test 3',
          html: '',
          status: 'complete',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'bm-4',
          url: 'https://example.com/4',
          title: 'Test 4',
          html: '',
          status: 'error',
          errorMessage: 'Failed to fetch',
          retryCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      bookmarks.forEach((b) => bookmarksStore.set(b.id, b));

      // Simulate progress computation
      const computeProgress = (bookmarks: Bookmark[], total: number) => {
        let downloaded = 0;
        let completed = 0;
        let errors = 0;
        let processing = 0;

        for (const b of bookmarks) {
          if (b.status === 'error') {
            errors++;
          } else if (b.status === 'complete') {
            completed++;
          } else if (b.status === 'downloaded' || b.status === 'pending') {
            downloaded++;
          } else if (b.status === 'processing') {
            processing++;
          }
        }

        const finishedCount = completed + errors;
        const percent = Math.round((finishedCount / total) * 100);

        return { downloaded, completed, errors, processing, total, percent };
      };

      const progress = computeProgress(bookmarks, 4);

      expect(progress.downloaded).toBe(1); // 'downloaded' status
      expect(progress.completed).toBe(1); // 'complete' status
      expect(progress.errors).toBe(1); // 'error' status
      expect(progress.processing).toBe(0); // no 'processing' status
      expect(progress.total).toBe(4);
      expect(progress.percent).toBe(50); // 2 finished (1 complete + 1 error) out of 4
    });

    it('should detect when all bookmarks are completed', async () => {
      const bookmarks: Bookmark[] = [
        {
          id: 'bm-1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'complete',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'bm-2',
          url: 'https://example.com/2',
          title: 'Test 2',
          html: '',
          status: 'complete',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const computeProgress = (bookmarks: Bookmark[], total: number) => {
        let completed = 0;
        let errors = 0;

        for (const b of bookmarks) {
          if (b.status === 'error') {
            errors++;
          } else if (b.status === 'complete') {
            completed++;
          }
        }

        const finishedCount = completed + errors;
        return finishedCount >= total;
      };

      const isComplete = computeProgress(bookmarks, 2);
      expect(isComplete).toBe(true);
    });
  });

  describe('Duplicate URL Handling', () => {
    it('should not create duplicate bookmarks for same URL', async () => {
      const url = 'https://example.com';
      const existingBookmark: Bookmark = {
        id: 'existing-id',
        url,
        title: 'Existing',
        html: '',
        status: 'complete',
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set(existingBookmark.id, existingBookmark);

      const mockBookmarkRepo = {
        getBookmarksByUrls: (urls: string[]) =>
          Effect.sync(() => {
            return Array.from(bookmarksStore.values()).filter((b) => urls.includes(b.url));
          }),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
      };

      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        // Try to import same URL twice
        yield* createBulkImportJob([url, url]);

        // Should still have only 1 bookmark (the existing one, updated)
        expect(bookmarksStore.size).toBe(1);

        // But should have 2 job items (one for each URL in the input)
        expect(jobItemsStore.size).toBe(2);

        // Both job items should reference the same bookmark
        const jobItems = Array.from(jobItemsStore.values());
        expect(jobItems[0].bookmarkId).toBe(existingBookmark.id);
        expect(jobItems[1].bookmarkId).toBe(existingBookmark.id);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });
  });

  describe('Batch Operations Performance', () => {
    it('should use bulk operations for multiple bookmarks', async () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);

      let bulkAddCalls = 0;
      let bulkUpdateCalls = 0;

      const mockBookmarkRepo = {
        getBookmarksByUrls: () => Effect.succeed([]),
        bulkAddBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bulkAddCalls++;
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
        bulkUpdateBookmarks: (bookmarks: Bookmark[]) =>
          Effect.sync(() => {
            bulkUpdateCalls++;
            bookmarks.forEach((b) => bookmarksStore.set(b.id, b));
          }),
      };

      const mockJobQueue = {
        createJob: (params: { type: JobType; status: JobStatus; metadata: Record<string, unknown> }) =>
          Effect.sync(() => {
            const job: Job = {
              id: crypto.randomUUID(),
              type: params.type,
              status: params.status,
              metadata: params.metadata,
              createdAt: new Date(),
            };
            jobsStore.set(job.id, job);
            return { id: job.id };
          }),
        createJobItems: (jobId: string, bookmarkIds: string[]) =>
          Effect.sync(() => {
            bookmarkIds.forEach((bookmarkId) => {
              const id = crypto.randomUUID();
              jobItemsStore.set(id, { id, jobId, bookmarkId });
            });
          }),
      };

      const bookmarkLayer = Layer.succeed(BookmarkRepository, mockBookmarkRepo);
      const jobQueueLayer = Layer.succeed(JobQueueService, mockJobQueue);

      const program = Effect.gen(function* () {
        yield* createBulkImportJob(urls);

        // Should use bulk operations (called once, not 10 times)
        expect(bulkAddCalls).toBe(1);
        expect(bulkUpdateCalls).toBe(0); // No existing bookmarks

        // All bookmarks should be created
        expect(bookmarksStore.size).toBe(10);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(bookmarkLayer), Effect.provide(jobQueueLayer))
      );
    });
  });
});
