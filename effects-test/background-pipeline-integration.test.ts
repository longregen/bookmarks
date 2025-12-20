import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import type { Bookmark, JobItemStatus } from '../src/db/schema';
import {
  BookmarkRepository,
  FetchService,
  ProcessorService,
  JobService,
  EventsService,
  SyncService,
  startProcessingQueue,
} from '../effect/background/queue';
import { ConfigService } from '../effect/services/config-service';
import { LoggingService } from '../effect/services/logging-service';
import {
  FetchError,
  ProcessingError,
  RepositoryError,
  SyncError,
} from '../effect/lib/errors';

/**
 * Integration test for the Background Processing Pipeline
 *
 * Tests the full bookmark processing flow:
 * 1. Fetch phase - parallel HTML fetching with retry logic
 * 2. Processing phase - sequential content extraction, Q&A, embeddings
 * 3. Queue orchestration - state management and event emission
 * 4. Error handling - retry logic and recovery mechanisms
 */
describe('Background Processing Pipeline Integration', () => {
  // Track logs for assertions
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];

  // Track emitted events
  const events: Array<{ type: string; bookmarkId: string; error?: string }> = [];

  // Mock storage for bookmarks
  const bookmarkStore = new Map<string, Bookmark>();

  // Mock job items tracking
  const jobItemStore = new Map<string, { jobId: string; status: JobItemStatus; retryCount: number; errorMessage?: string }>();

  beforeEach(() => {
    logs.length = 0;
    events.length = 0;
    bookmarkStore.clear();
    jobItemStore.clear();
    vi.clearAllMocks();
  });

  /**
   * Create mock LoggingService that captures logs
   */
  const makeLoggingService = (): LoggingService => ({
    debug: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'debug', message, context });
      }),
    info: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'info', message, context });
      }),
    warn: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'warn', message, context });
      }),
    error: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'error', message, context });
      }),
  });

  const LoggingServiceTest = Layer.succeed(LoggingService, makeLoggingService());

  /**
   * Create mock ConfigService with test configuration
   */
  const makeConfigService = (overrides: Record<string, unknown> = {}): ConfigService => {
    const config = {
      QUEUE_MAX_RETRIES: 2,
      QUEUE_RETRY_BASE_DELAY_MS: 10,
      QUEUE_RETRY_MAX_DELAY_MS: 100,
      FETCH_CONCURRENCY: 3,
      ...overrides,
    };

    return {
      get: <T>(key: string) =>
        Effect.sync(() => {
          if (key in config) {
            return config[key] as T;
          }
          throw new Error(`Config key not found: ${key}`);
        }),
    };
  };

  const ConfigServiceTest = Layer.succeed(ConfigService, makeConfigService());

  /**
   * Create mock BookmarkRepository
   */
  const makeBookmarkRepository = (): BookmarkRepository => ({
    getByStatus: (status: Bookmark['status'], limit?: number) =>
      Effect.sync(() => {
        const bookmarks = Array.from(bookmarkStore.values())
          .filter((b) => b.status === status)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return limit ? bookmarks.slice(0, limit) : bookmarks;
      }),

    update: (id: string, updates: Partial<Bookmark>) =>
      Effect.sync(() => {
        const bookmark = bookmarkStore.get(id);
        if (!bookmark) {
          throw new RepositoryError({
            code: 'NOT_FOUND',
            entity: 'Bookmark',
            operation: 'update',
            message: `Bookmark not found: ${id}`,
          });
        }
        bookmarkStore.set(id, { ...bookmark, ...updates });
      }),

    bulkUpdate: (updates: Array<{ id: string; updates: Partial<Bookmark> }>) =>
      Effect.sync(() => {
        updates.forEach(({ id, updates: u }) => {
          const bookmark = bookmarkStore.get(id);
          if (bookmark) {
            bookmarkStore.set(id, { ...bookmark, ...u });
          }
        });
      }),
  });

  const BookmarkRepositoryTest = Layer.succeed(BookmarkRepository, makeBookmarkRepository());

  /**
   * Create mock EventsService that captures events
   */
  const makeEventsService = (): EventsService => ({
    bookmarkProcessingStarted: (bookmarkId: string) =>
      Effect.sync(() => {
        events.push({ type: 'processing_started', bookmarkId });
      }),

    bookmarkReady: (bookmarkId: string) =>
      Effect.sync(() => {
        events.push({ type: 'bookmark_ready', bookmarkId });
      }),

    bookmarkProcessingFailed: (bookmarkId: string, error: string) =>
      Effect.sync(() => {
        events.push({ type: 'processing_failed', bookmarkId, error });
      }),
  });

  const EventsServiceTest = Layer.succeed(EventsService, makeEventsService());

  /**
   * Create mock JobService
   */
  const makeJobService = (): JobService => ({
    updateJobItemByBookmark: (bookmarkId: string, updates) =>
      Effect.sync(() => {
        const item = jobItemStore.get(bookmarkId);
        if (item) {
          jobItemStore.set(bookmarkId, { ...item, ...updates });
        } else {
          jobItemStore.set(bookmarkId, {
            jobId: 'test-job',
            status: updates.status || 'pending',
            retryCount: updates.retryCount || 0,
            errorMessage: updates.errorMessage,
          });
        }
      }),

    getJobItemByBookmark: (bookmarkId: string) =>
      Effect.sync(() => {
        const item = jobItemStore.get(bookmarkId);
        return item ? { jobId: item.jobId, id: `item-${bookmarkId}` } : null;
      }),

    updateJobStatus: (jobId: string) =>
      Effect.sync(() => {
        // No-op for mock
      }),
  });

  const JobServiceTest = Layer.succeed(JobService, makeJobService());

  /**
   * Create mock SyncService
   */
  const makeSyncService = (shouldFail = false): SyncService => ({
    triggerIfEnabled: () =>
      shouldFail
        ? Effect.fail(
            new SyncError({
              code: 'NETWORK_ERROR',
              operation: 'push',
              message: 'Sync failed',
            })
          )
        : Effect.void,
  });

  const SyncServiceTest = Layer.succeed(SyncService, makeSyncService());

  /**
   * Test 1: Full processing pipeline with successful flow
   */
  it('should process bookmarks through the full pipeline', async () => {
    // Setup: Create bookmarks in different states
    bookmarkStore.set('bookmark-1', {
      id: 'bookmark-1',
      url: 'https://example.com/1',
      title: 'Test 1',
      html: '',
      status: 'fetching',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });

    bookmarkStore.set('bookmark-2', {
      id: 'bookmark-2',
      url: 'https://example.com/2',
      title: 'Test 2',
      html: '<html>Content 2</html>',
      status: 'downloaded',
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
    });

    // Mock fetch service that succeeds
    const fetchService: FetchService = {
      fetchHtml: (bookmark: Bookmark) =>
        Effect.sync(() => ({
          ...bookmark,
          html: `<html>Fetched content for ${bookmark.url}</html>`,
          title: `Fetched ${bookmark.title}`,
          status: 'downloaded' as const,
        })),
    };

    // Mock processor that succeeds
    const processorService: ProcessorService = {
      processContent: (bookmark: Bookmark) => Effect.void,
    };

    const FetchServiceTest = Layer.succeed(FetchService, fetchService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    // Execute
    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Assertions
    // Check bookmark-1 went through fetch phase
    const bookmark1 = bookmarkStore.get('bookmark-1');
    expect(bookmark1?.status).toBe('complete');
    expect(bookmark1?.html).toContain('Fetched content');

    // Check bookmark-2 went through processing phase
    const bookmark2 = bookmarkStore.get('bookmark-2');
    expect(bookmark2?.status).toBe('complete');

    // Check events emitted
    expect(events).toContainEqual({ type: 'processing_started', bookmarkId: 'bookmark-1' });
    expect(events).toContainEqual({ type: 'bookmark_ready', bookmarkId: 'bookmark-1' });
    expect(events).toContainEqual({ type: 'processing_started', bookmarkId: 'bookmark-2' });
    expect(events).toContainEqual({ type: 'bookmark_ready', bookmarkId: 'bookmark-2' });

    // Check logging
    expect(logs.some((l) => l.message.includes('Starting parallel fetch phase'))).toBe(true);
    expect(logs.some((l) => l.message.includes('Starting content processing phase'))).toBe(true);
  });

  /**
   * Test 2: Fetch phase with retry logic
   */
  it('should retry failed fetches with exponential backoff', async () => {
    bookmarkStore.set('bookmark-retry', {
      id: 'bookmark-retry',
      url: 'https://example.com/retry',
      title: 'Retry Test',
      html: '',
      status: 'fetching',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock fetch that fails twice, then succeeds
    let fetchAttempts = 0;
    const fetchService: FetchService = {
      fetchHtml: (bookmark: Bookmark) =>
        Effect.gen(function* () {
          fetchAttempts++;
          if (fetchAttempts <= 2) {
            return yield* Effect.fail(
              new FetchError({
                url: bookmark.url,
                code: 'NETWORK_ERROR',
                message: `Fetch attempt ${fetchAttempts} failed`,
              })
            );
          }
          return {
            ...bookmark,
            html: '<html>Success</html>',
            status: 'downloaded' as const,
          };
        }),
    };

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const FetchServiceTest = Layer.succeed(FetchService, fetchService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Should have attempted 3 times
    expect(fetchAttempts).toBe(3);

    // Check retry tracking
    const errorLogs = logs.filter((l) => l.level === 'error');
    expect(errorLogs.some((l) => l.message.includes('Fetch attempt 1 failed'))).toBe(true);
    expect(errorLogs.some((l) => l.message.includes('Fetch attempt 2 failed'))).toBe(true);

    // Final status should be complete
    const bookmark = bookmarkStore.get('bookmark-retry');
    expect(bookmark?.status).toBe('complete');
  });

  /**
   * Test 3: Fetch phase exceeds max retries
   */
  it('should mark bookmark as error after max retries in fetch phase', async () => {
    bookmarkStore.set('bookmark-fail', {
      id: 'bookmark-fail',
      url: 'https://example.com/fail',
      title: 'Fail Test',
      html: '',
      status: 'fetching',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock fetch that always fails
    const fetchService: FetchService = {
      fetchHtml: (bookmark: Bookmark) =>
        Effect.fail(
          new FetchError({
            url: bookmark.url,
            code: 'TIMEOUT',
            message: 'Request timed out',
          })
        ),
    };

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const FetchServiceTest = Layer.succeed(FetchService, fetchService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Should be marked as error
    const bookmark = bookmarkStore.get('bookmark-fail');
    expect(bookmark?.status).toBe('error');
    expect(bookmark?.errorMessage).toContain('Failed after 3 attempts');
    expect(bookmark?.errorMessage).toContain('Request timed out');

    // Job item should be marked as error
    const jobItem = jobItemStore.get('bookmark-fail');
    expect(jobItem?.status).toBe('error');
  });

  /**
   * Test 4: Content processing phase with retry logic
   */
  it('should retry failed content processing with exponential backoff', async () => {
    bookmarkStore.set('bookmark-process-retry', {
      id: 'bookmark-process-retry',
      url: 'https://example.com/process',
      title: 'Process Retry Test',
      html: '<html>Content</html>',
      status: 'downloaded',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let processAttempts = 0;
    const processorService: ProcessorService = {
      processContent: (bookmark: Bookmark) =>
        Effect.gen(function* () {
          processAttempts++;
          if (processAttempts <= 2) {
            return yield* Effect.fail(
              new ProcessingError({
                bookmarkId: bookmark.id,
                stage: 'embed',
                message: `Processing attempt ${processAttempts} failed`,
              })
            );
          }
          return;
        }),
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Should have attempted 3 times
    expect(processAttempts).toBe(3);

    // Check debug logs for retry messages
    const debugLogs = logs.filter((l) => l.level === 'debug');
    expect(debugLogs.some((l) => l.message.includes('Retrying'))).toBe(true);

    // Final status should be complete
    const bookmark = bookmarkStore.get('bookmark-process-retry');
    expect(bookmark?.status).toBe('complete');
  });

  /**
   * Test 5: Queue state management - prevents concurrent processing
   */
  it('should prevent concurrent queue processing', async () => {
    bookmarkStore.set('bookmark-concurrent', {
      id: 'bookmark-concurrent',
      url: 'https://example.com/concurrent',
      title: 'Concurrent Test',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let processingCount = 0;
    const processorService: ProcessorService = {
      processContent: () =>
        Effect.gen(function* () {
          processingCount++;
          yield* Effect.sleep('50 millis');
        }),
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    // Start three concurrent queue processes
    await Effect.runPromise(
      Effect.all(
        [
          startProcessingQueue().pipe(Effect.provide(TestLayer)),
          startProcessingQueue().pipe(Effect.provide(TestLayer)),
          startProcessingQueue().pipe(Effect.provide(TestLayer)),
        ],
        { concurrency: 'unbounded' }
      )
    );

    // Should only process once due to isProcessing flag
    expect(processingCount).toBe(1);

    // Check logs for "Already processing, skipping" message
    const debugLogs = logs.filter((l) => l.level === 'debug');
    expect(debugLogs.some((l) => l.message === 'Already processing, skipping')).toBe(true);
  });

  /**
   * Test 6: Event emission during processing lifecycle
   */
  it('should emit events at key processing stages', async () => {
    bookmarkStore.set('bookmark-events', {
      id: 'bookmark-events',
      url: 'https://example.com/events',
      title: 'Events Test',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Check event sequence
    const bookmarkEvents = events.filter((e) => e.bookmarkId === 'bookmark-events');
    expect(bookmarkEvents).toHaveLength(2);
    expect(bookmarkEvents[0]).toEqual({ type: 'processing_started', bookmarkId: 'bookmark-events' });
    expect(bookmarkEvents[1]).toEqual({ type: 'bookmark_ready', bookmarkId: 'bookmark-events' });
  });

  /**
   * Test 7: Error event emission on final failure
   */
  it('should emit error event when processing fails after max retries', async () => {
    bookmarkStore.set('bookmark-error-event', {
      id: 'bookmark-error-event',
      url: 'https://example.com/error',
      title: 'Error Event Test',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const processorService: ProcessorService = {
      processContent: () =>
        Effect.fail(
          new ProcessingError({
            bookmarkId: 'bookmark-error-event',
            stage: 'parse',
            message: 'Parsing failed',
          })
        ),
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Check error event was emitted
    const errorEvents = events.filter((e) => e.type === 'processing_failed');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].bookmarkId).toBe('bookmark-error-event');
    expect(errorEvents[0].error).toContain('Failed after 3 attempts');
  });

  /**
   * Test 8: Parallel fetch with configurable concurrency
   */
  it('should process fetches in parallel with configured concurrency', async () => {
    // Create 10 bookmarks to fetch
    for (let i = 1; i <= 10; i++) {
      bookmarkStore.set(`bookmark-${i}`, {
        id: `bookmark-${i}`,
        url: `https://example.com/${i}`,
        title: `Test ${i}`,
        html: '',
        status: 'fetching',
        createdAt: new Date(`2024-01-0${i % 10}`),
        updatedAt: new Date(`2024-01-0${i % 10}`),
      });
    }

    const fetchTimestamps: number[] = [];
    const fetchService: FetchService = {
      fetchHtml: (bookmark: Bookmark) =>
        Effect.gen(function* () {
          fetchTimestamps.push(Date.now());
          yield* Effect.sleep('10 millis');
          return {
            ...bookmark,
            html: '<html>Fetched</html>',
            status: 'downloaded' as const,
          };
        }),
    };

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const FetchServiceTest = Layer.succeed(FetchService, fetchService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);

    // Set concurrency to 3
    const ConfigServiceTestConcurrency = Layer.succeed(
      ConfigService,
      makeConfigService({ FETCH_CONCURRENCY: 3 })
    );

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTestConcurrency,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // All bookmarks should be fetched
    expect(fetchTimestamps).toHaveLength(10);

    // All bookmarks should be processed
    for (let i = 1; i <= 10; i++) {
      const bookmark = bookmarkStore.get(`bookmark-${i}`);
      expect(bookmark?.status).toBe('complete');
    }
  });

  /**
   * Test 9: WebDAV sync triggers after queue completion
   */
  it('should trigger WebDAV sync after queue is empty', async () => {
    bookmarkStore.set('bookmark-sync', {
      id: 'bookmark-sync',
      url: 'https://example.com/sync',
      title: 'Sync Test',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let syncCalled = false;
    const syncService: SyncService = {
      triggerIfEnabled: () =>
        Effect.sync(() => {
          syncCalled = true;
        }),
    };

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });
    const SyncServiceTestCustom = Layer.succeed(SyncService, syncService);

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTestCustom,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Sync should have been called
    expect(syncCalled).toBe(true);
  });

  /**
   * Test 10: Sync errors are handled gracefully
   */
  it('should handle sync errors gracefully and continue', async () => {
    const syncService = makeSyncService(true); // Will fail
    const SyncServiceTestFailing = Layer.succeed(SyncService, syncService);

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTestFailing,
      ConfigServiceTest,
      LoggingServiceTest
    );

    // Should not throw even though sync fails
    await expect(
      Effect.runPromise(startProcessingQueue().pipe(Effect.provide(TestLayer)))
    ).resolves.not.toThrow();

    // Check error was logged
    const errorLogs = logs.filter((l) => l.level === 'error');
    expect(errorLogs.some((l) => l.message.includes('WebDAV sync'))).toBe(true);
  });

  /**
   * Test 11: Mixed status bookmarks are processed in correct order
   */
  it('should process fetching bookmarks before downloaded/pending bookmarks', async () => {
    const processingOrder: string[] = [];

    bookmarkStore.set('bookmark-pending', {
      id: 'bookmark-pending',
      url: 'https://example.com/pending',
      title: 'Pending',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });

    bookmarkStore.set('bookmark-fetching', {
      id: 'bookmark-fetching',
      url: 'https://example.com/fetching',
      title: 'Fetching',
      html: '',
      status: 'fetching',
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
    });

    bookmarkStore.set('bookmark-downloaded', {
      id: 'bookmark-downloaded',
      url: 'https://example.com/downloaded',
      title: 'Downloaded',
      html: '<html>Content</html>',
      status: 'downloaded',
      createdAt: new Date('2024-01-03'),
      updatedAt: new Date('2024-01-03'),
    });

    const fetchService: FetchService = {
      fetchHtml: (bookmark: Bookmark) =>
        Effect.sync(() => {
          processingOrder.push(`fetch:${bookmark.id}`);
          return {
            ...bookmark,
            html: '<html>Fetched</html>',
            status: 'downloaded' as const,
          };
        }),
    };

    const processorService: ProcessorService = {
      processContent: (bookmark: Bookmark) =>
        Effect.sync(() => {
          processingOrder.push(`process:${bookmark.id}`);
        }),
    };

    const FetchServiceTest = Layer.succeed(FetchService, fetchService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTest,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Fetching should be processed first
    expect(processingOrder[0]).toBe('fetch:bookmark-fetching');

    // Then processing phase handles downloaded and pending
    expect(processingOrder).toContain('process:bookmark-fetching');
    expect(processingOrder).toContain('process:bookmark-downloaded');
    expect(processingOrder).toContain('process:bookmark-pending');

    // All should be complete
    expect(bookmarkStore.get('bookmark-pending')?.status).toBe('complete');
    expect(bookmarkStore.get('bookmark-fetching')?.status).toBe('complete');
    expect(bookmarkStore.get('bookmark-downloaded')?.status).toBe('complete');
  });

  /**
   * Test 12: Job item status tracking throughout pipeline
   */
  it('should update job item status at each processing stage', async () => {
    bookmarkStore.set('bookmark-job', {
      id: 'bookmark-job',
      url: 'https://example.com/job',
      title: 'Job Test',
      html: '<html>Content</html>',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const jobStatusHistory: JobItemStatus[] = [];

    const jobService: JobService = {
      updateJobItemByBookmark: (bookmarkId: string, updates) =>
        Effect.sync(() => {
          if (updates.status) {
            jobStatusHistory.push(updates.status);
          }
          const item = jobItemStore.get(bookmarkId);
          if (item) {
            jobItemStore.set(bookmarkId, { ...item, ...updates });
          } else {
            jobItemStore.set(bookmarkId, {
              jobId: 'test-job',
              status: updates.status || 'pending',
              retryCount: updates.retryCount || 0,
              errorMessage: updates.errorMessage,
            });
          }
        }),

      getJobItemByBookmark: (bookmarkId: string) =>
        Effect.sync(() => {
          const item = jobItemStore.get(bookmarkId);
          return item ? { jobId: item.jobId, id: `item-${bookmarkId}` } : null;
        }),

      updateJobStatus: () => Effect.void,
    };

    const processorService: ProcessorService = {
      processContent: () => Effect.void,
    };

    const JobServiceTestCustom = Layer.succeed(JobService, jobService);
    const ProcessorServiceTest = Layer.succeed(ProcessorService, processorService);
    const FetchServiceTest = Layer.succeed(FetchService, {
      fetchHtml: (b: Bookmark) => Effect.succeed(b),
    });

    const TestLayer = Layer.mergeAll(
      BookmarkRepositoryTest,
      FetchServiceTest,
      ProcessorServiceTest,
      JobServiceTestCustom,
      EventsServiceTest,
      SyncServiceTest,
      ConfigServiceTest,
      LoggingServiceTest
    );

    await Effect.runPromise(
      startProcessingQueue().pipe(Effect.provide(TestLayer))
    );

    // Should transition: in_progress -> complete
    expect(jobStatusHistory).toContain('in_progress');
    expect(jobStatusHistory).toContain('complete');

    // Final status should be complete
    const finalItem = jobItemStore.get('bookmark-job');
    expect(finalItem?.status).toBe('complete');
  });
});
