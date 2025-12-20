import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import type {
  Job,
  JobItem,
  JobType,
  JobStatus,
  JobItemStatus,
  Bookmark,
  BookmarkStatus,
} from '../effect/db/schema';
import { JobService, StorageService } from '../effect/lib/jobs';
import type { IStorageService, QueryFilter } from '../effect/lib/jobs';
import {
  BookmarkRepository,
  FetchService,
  ProcessorService,
  EventsService,
  ConfigService,
  LoggingService,
  SyncService,
  startProcessingQueue,
} from '../effect/background/queue';
import { EventService, type EventData, type EventType, type EventPayloads } from '../effect/lib/events';
import { RepositoryError, StorageError } from '../effect/lib/errors';

/**
 * Integration test for Job Queue Management in Effect.ts refactored codebase
 *
 * Tests the full cooperation between:
 * - JobService: Job and JobItem management
 * - Queue: Processing pipeline orchestration
 * - Events: Event broadcasting for job lifecycle
 * - Bookmarks: Status transitions and retry logic
 */
describe('Job Queue Management Integration', () => {
  // Test state
  let bookmarksStore: Map<string, Bookmark>;
  let jobsStore: Map<string, Job>;
  let jobItemsStore: Map<string, JobItem>;
  let eventLog: Array<{ type: EventType; payload: unknown }>;
  let logMessages: string[];

  // Mock implementations
  const createMockStorageService = (): IStorageService => ({
    get: <T>(table: string, key: string) =>
      Effect.sync(() => {
        if (table === 'jobs') {
          return (jobsStore.get(key) as T) ?? null;
        }
        if (table === 'jobItems') {
          return (jobItemsStore.get(key) as T) ?? null;
        }
        if (table === 'bookmarks') {
          return (bookmarksStore.get(key) as T) ?? null;
        }
        return null;
      }),

    put: <T>(table: string, key: string, value: T) =>
      Effect.sync(() => {
        if (table === 'jobs') {
          jobsStore.set(key, value as Job);
        } else if (table === 'jobItems') {
          jobItemsStore.set(key, value as JobItem);
        } else if (table === 'bookmarks') {
          bookmarksStore.set(key, value as Bookmark);
        }
      }),

    delete: (table: string, key: string) =>
      Effect.sync(() => {
        if (table === 'jobs') {
          jobsStore.delete(key);
        } else if (table === 'jobItems') {
          jobItemsStore.delete(key);
        } else if (table === 'bookmarks') {
          bookmarksStore.delete(key);
        }
      }),

    bulkPut: <T>(table: string, items: readonly T[]) =>
      Effect.sync(() => {
        if (table === 'jobItems') {
          (items as JobItem[]).forEach((item) => {
            jobItemsStore.set(item.id, item);
          });
        } else if (table === 'bookmarks') {
          (items as Bookmark[]).forEach((item) => {
            bookmarksStore.set(item.id, item);
          });
        }
      }),

    bulkDelete: (table: string, keys: readonly string[]) =>
      Effect.sync(() => {
        if (table === 'jobItems') {
          keys.forEach((key) => jobItemsStore.delete(key));
        } else if (table === 'bookmarks') {
          keys.forEach((key) => bookmarksStore.delete(key));
        }
      }),

    query: <T>(table: string, filter: QueryFilter) =>
      Effect.sync(() => {
        if (table === 'jobs') {
          let results = Array.from(jobsStore.values());
          if (filter.field && filter.operator === 'eq') {
            results = results.filter((job) => job[filter.field as keyof Job] === filter.value);
          }
          if (filter.sort) {
            results.sort((a, b) => {
              const sortField = filter.sort![0].field as keyof Job;
              const direction = filter.sort![0].direction;
              const aVal = a[sortField];
              const bVal = b[sortField];
              if (aVal instanceof Date && bVal instanceof Date) {
                return direction === 'desc'
                  ? bVal.getTime() - aVal.getTime()
                  : aVal.getTime() - bVal.getTime();
              }
              return 0;
            });
          }
          if (filter.limit) {
            results = results.slice(0, filter.limit);
          }
          return results as readonly T[];
        }
        if (table === 'jobItems') {
          let results = Array.from(jobItemsStore.values());
          if (filter.field && filter.operator === 'eq') {
            results = results.filter(
              (item) => item[filter.field as keyof JobItem] === filter.value
            );
          }
          if (filter.limit) {
            results = results.slice(0, filter.limit);
          }
          return results as readonly T[];
        }
        if (table === 'bookmarks') {
          let results = Array.from(bookmarksStore.values());
          if (filter.field && filter.operator === 'eq') {
            results = results.filter(
              (bookmark) => bookmark[filter.field as keyof Bookmark] === filter.value
            );
          }
          if (filter.limit) {
            results = results.slice(0, filter.limit);
          }
          return results as readonly T[];
        }
        return [] as readonly T[];
      }),

    update: <T>(table: string, key: string, updates: Partial<T>) =>
      Effect.sync(() => {
        if (table === 'jobs') {
          const existing = jobsStore.get(key);
          if (existing) {
            jobsStore.set(key, { ...existing, ...updates });
          }
        } else if (table === 'jobItems') {
          const existing = jobItemsStore.get(key);
          if (existing) {
            jobItemsStore.set(key, { ...existing, ...updates });
          }
        } else if (table === 'bookmarks') {
          const existing = bookmarksStore.get(key);
          if (existing) {
            bookmarksStore.set(key, { ...existing, ...updates });
          }
        }
      }),

    bulkUpdate: <T>(table: string, updates: readonly { key: string; changes: Partial<T> }[]) =>
      Effect.sync(() => {
        if (table === 'jobItems') {
          updates.forEach(({ key, changes }) => {
            const existing = jobItemsStore.get(key);
            if (existing) {
              jobItemsStore.set(key, { ...existing, ...changes });
            }
          });
        } else if (table === 'bookmarks') {
          updates.forEach(({ key, changes }) => {
            const existing = bookmarksStore.get(key);
            if (existing) {
              bookmarksStore.set(key, { ...existing, ...changes });
            }
          });
        }
      }),
  });

  const createMockEventService = () => ({
    broadcastEvent: <T extends EventType>(type: T, payload: EventPayloads[T]) =>
      Effect.sync(() => {
        eventLog.push({ type, payload });
      }),
    addEventListener: (listener: (event: EventData) => void) => Effect.void,
  });

  beforeEach(() => {
    // Reset stores
    bookmarksStore = new Map();
    jobsStore = new Map();
    jobItemsStore = new Map();
    eventLog = [];
    logMessages = [];

    vi.clearAllMocks();
  });

  describe('Job Creation and Lifecycle', () => {
    it('should create a job with pending status', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: () => Effect.void,
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: () =>
                Effect.succeed({
                  total: 0,
                  pending: 0,
                  inProgress: 0,
                  complete: 0,
                  error: 0,
                }),
              updateJobStatus: () => Effect.void,
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'pending',
          metadata: { totalUrls: 5 },
        });

        expect(job.id).toBeDefined();
        expect(job.type).toBe('bulk_url_import');
        expect(job.status).toBe('pending');
        expect(job.metadata.totalUrls).toBe(5);
        expect(job.createdAt).toBeInstanceOf(Date);

        // Verify job is persisted
        const stored = jobsStore.get(job.id);
        expect(stored).toBeDefined();
        expect(stored?.id).toBe(job.id);
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });

    it('should create job items for a job', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: () => Effect.void,
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: () =>
                Effect.succeed({
                  total: 0,
                  pending: 0,
                  inProgress: 0,
                  complete: 0,
                  error: 0,
                }),
              updateJobStatus: () => Effect.void,
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        const bookmarkIds = ['bm-1', 'bm-2', 'bm-3'];
        yield* jobService.createJobItems(job.id, bookmarkIds);

        const items = yield* jobService.getJobItems(job.id);
        expect(items).toHaveLength(3);
        expect(items.every((item) => item.jobId === job.id)).toBe(true);
        expect(items.every((item) => item.status === 'pending')).toBe(true);
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });
  });

  describe('Job Status Transitions', () => {
    it('should transition job status based on item completion', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: (id: string, updates: Partial<JobItem>) =>
                storage.update('jobItems', id, { ...updates, updatedAt: new Date() }),
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );
                  return {
                    total: items.length,
                    pending: stats.pending,
                    inProgress: stats.in_progress,
                    complete: stats.complete,
                    error: stats.error,
                  };
                }),
              updateJobStatus: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );

                  let status: JobStatus;
                  const total = items.length;

                  if (total === 0 || stats.complete === total) {
                    status = 'completed';
                  } else if (stats.error > 0 && stats.pending === 0 && stats.in_progress === 0) {
                    status = stats.complete > 0 ? 'completed' : 'failed';
                  } else if (stats.in_progress > 0 || stats.pending > 0) {
                    status = 'in_progress';
                  } else {
                    status = 'completed';
                  }

                  yield* storage.update<Job>('jobs', jobId, { status });
                }),
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        yield* jobService.createJobItems(job.id, ['bm-1', 'bm-2', 'bm-3']);

        // Initially all pending
        let stats = yield* jobService.getJobStats(job.id);
        expect(stats.pending).toBe(3);

        // Complete one item
        const items = yield* jobService.getJobItems(job.id);
        yield* jobService.updateJobItem(items[0].id, { status: 'complete' });
        yield* jobService.updateJobStatus(job.id);

        let storedJob = jobsStore.get(job.id);
        expect(storedJob?.status).toBe('in_progress');

        // Complete all items
        yield* jobService.updateJobItem(items[1].id, { status: 'complete' });
        yield* jobService.updateJobItem(items[2].id, { status: 'complete' });
        yield* jobService.updateJobStatus(job.id);

        storedJob = jobsStore.get(job.id);
        expect(storedJob?.status).toBe('completed');
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });

    it('should mark job as failed when all items fail', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: (id: string, updates: Partial<JobItem>) =>
                storage.update('jobItems', id, { ...updates, updatedAt: new Date() }),
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );
                  return {
                    total: items.length,
                    pending: stats.pending,
                    inProgress: stats.in_progress,
                    complete: stats.complete,
                    error: stats.error,
                  };
                }),
              updateJobStatus: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );

                  let status: JobStatus;
                  const total = items.length;

                  if (total === 0 || stats.complete === total) {
                    status = 'completed';
                  } else if (stats.error > 0 && stats.pending === 0 && stats.in_progress === 0) {
                    status = stats.complete > 0 ? 'completed' : 'failed';
                  } else if (stats.in_progress > 0 || stats.pending > 0) {
                    status = 'in_progress';
                  } else {
                    status = 'completed';
                  }

                  yield* storage.update<Job>('jobs', jobId, { status });
                }),
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        yield* jobService.createJobItems(job.id, ['bm-1', 'bm-2']);

        // Fail all items
        const items = yield* jobService.getJobItems(job.id);
        yield* jobService.updateJobItem(items[0].id, {
          status: 'error',
          errorMessage: 'Network error',
        });
        yield* jobService.updateJobItem(items[1].id, {
          status: 'error',
          errorMessage: 'Timeout',
        });
        yield* jobService.updateJobStatus(job.id);

        const storedJob = jobsStore.get(job.id);
        expect(storedJob?.status).toBe('failed');
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });
  });

  describe('Event Emission', () => {
    it('should emit job:created event when job is created', async () => {
      const eventService = createMockEventService();
      const eventLayer = Layer.succeed(EventService, eventService);

      const program = Effect.gen(function* () {
        const events = yield* EventService;
        yield* events.broadcastEvent('job:created', { jobId: 'job-1', totalItems: 5 });

        expect(eventLog).toHaveLength(1);
        expect(eventLog[0].type).toBe('job:created');
        expect(eventLog[0].payload).toEqual({ jobId: 'job-1', totalItems: 5 });
      });

      await Effect.runPromise(program.pipe(Effect.provide(eventLayer)));
    });

    it('should emit job:progress_changed during processing', async () => {
      const eventService = createMockEventService();
      const eventLayer = Layer.succeed(EventService, eventService);

      const program = Effect.gen(function* () {
        const events = yield* EventService;
        yield* events.broadcastEvent('job:progress_changed', {
          jobId: 'job-1',
          completedCount: 3,
          totalCount: 10,
        });

        expect(eventLog).toHaveLength(1);
        expect(eventLog[0].type).toBe('job:progress_changed');
        expect(eventLog[0].payload).toEqual({
          jobId: 'job-1',
          completedCount: 3,
          totalCount: 10,
        });
      });

      await Effect.runPromise(program.pipe(Effect.provide(eventLayer)));
    });

    it('should emit job:completed when all items complete', async () => {
      const eventService = createMockEventService();
      const eventLayer = Layer.succeed(EventService, eventService);

      const program = Effect.gen(function* () {
        const events = yield* EventService;
        yield* events.broadcastEvent('job:completed', { jobId: 'job-1' });

        expect(eventLog).toHaveLength(1);
        expect(eventLog[0].type).toBe('job:completed');
        expect(eventLog[0].payload).toEqual({ jobId: 'job-1' });
      });

      await Effect.runPromise(program.pipe(Effect.provide(eventLayer)));
    });

    it('should emit job:failed when job fails', async () => {
      const eventService = createMockEventService();
      const eventLayer = Layer.succeed(EventService, eventService);

      const program = Effect.gen(function* () {
        const events = yield* EventService;
        yield* events.broadcastEvent('job:failed', { jobId: 'job-1', errorCount: 5 });

        expect(eventLog).toHaveLength(1);
        expect(eventLog[0].type).toBe('job:failed');
        expect(eventLog[0].payload).toEqual({ jobId: 'job-1', errorCount: 5 });
      });

      await Effect.runPromise(program.pipe(Effect.provide(eventLayer)));
    });
  });

  describe('Job Retry Logic', () => {
    it('should retry failed job items', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: (id: string, updates: Partial<JobItem>) =>
                storage.update('jobItems', id, { ...updates, updatedAt: new Date() }),
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );
                  return {
                    total: items.length,
                    pending: stats.pending,
                    inProgress: stats.in_progress,
                    complete: stats.complete,
                    error: stats.error,
                  };
                }),
              updateJobStatus: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const stats = items.reduce(
                    (acc, item) => {
                      acc[item.status]++;
                      return acc;
                    },
                    { pending: 0, in_progress: 0, complete: 0, error: 0 }
                  );

                  let status: JobStatus;
                  const total = items.length;

                  if (total === 0 || stats.complete === total) {
                    status = 'completed';
                  } else if (stats.error > 0 && stats.pending === 0 && stats.in_progress === 0) {
                    status = stats.complete > 0 ? 'completed' : 'failed';
                  } else if (stats.in_progress > 0 || stats.pending > 0) {
                    status = 'in_progress';
                  } else {
                    status = 'completed';
                  }

                  yield* storage.update<Job>('jobs', jobId, { status });
                }),
              retryFailedJobItems: (jobId: string) =>
                Effect.gen(function* () {
                  const items = yield* storage.query<JobItem>('jobItems', {
                    field: 'jobId',
                    operator: 'eq',
                    value: jobId,
                  });
                  const failedItems = items.filter((item) => item.status === 'error');

                  if (failedItems.length === 0) {
                    return 0;
                  }

                  const now = new Date();
                  yield* storage.bulkUpdate<JobItem>(
                    'jobItems',
                    failedItems.map((item) => ({
                      key: item.id,
                      changes: {
                        status: 'pending',
                        retryCount: 0,
                        errorMessage: undefined,
                        updatedAt: now,
                      },
                    }))
                  );

                  yield* storage.bulkUpdate<Bookmark>(
                    'bookmarks',
                    failedItems.map((item) => ({
                      key: item.bookmarkId,
                      changes: {
                        status: 'fetching' as BookmarkStatus,
                        errorMessage: undefined,
                        retryCount: 0,
                        updatedAt: now,
                      },
                    }))
                  );

                  return failedItems.length;
                }),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        yield* jobService.createJobItems(job.id, ['bm-1', 'bm-2', 'bm-3']);

        // Create corresponding bookmarks
        const bookmark1: Bookmark = {
          id: 'bm-1',
          url: 'https://example.com/1',
          title: 'Test 1',
          html: '',
          status: 'error',
          errorMessage: 'Failed',
          retryCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const bookmark2: Bookmark = {
          id: 'bm-2',
          url: 'https://example.com/2',
          title: 'Test 2',
          html: '',
          status: 'error',
          errorMessage: 'Failed',
          retryCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const bookmark3: Bookmark = {
          id: 'bm-3',
          url: 'https://example.com/3',
          title: 'Test 3',
          html: '',
          status: 'complete',
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        bookmarksStore.set('bm-1', bookmark1);
        bookmarksStore.set('bm-2', bookmark2);
        bookmarksStore.set('bm-3', bookmark3);

        // Fail two items
        const items = yield* jobService.getJobItems(job.id);
        yield* jobService.updateJobItem(items[0].id, {
          status: 'error',
          errorMessage: 'Network error',
        });
        yield* jobService.updateJobItem(items[1].id, {
          status: 'error',
          errorMessage: 'Timeout',
        });
        yield* jobService.updateJobItem(items[2].id, { status: 'complete' });

        // Retry failed items
        const retriedCount = yield* jobService.retryFailedJobItems(job.id);
        expect(retriedCount).toBe(2);

        // Check items are reset to pending
        const updatedItems = yield* jobService.getJobItems(job.id);
        const retriedItems = updatedItems.filter((item) => item.bookmarkId === 'bm-1' || item.bookmarkId === 'bm-2');
        expect(retriedItems.every((item) => item.status === 'pending')).toBe(true);
        expect(retriedItems.every((item) => item.retryCount === 0)).toBe(true);
        expect(retriedItems.every((item) => item.errorMessage === undefined)).toBe(true);

        // Check bookmarks are reset to fetching
        const updatedBm1 = bookmarksStore.get('bm-1');
        const updatedBm2 = bookmarksStore.get('bm-2');
        expect(updatedBm1?.status).toBe('fetching');
        expect(updatedBm2?.status).toBe('fetching');
        expect(updatedBm1?.retryCount).toBe(0);
        expect(updatedBm2?.retryCount).toBe(0);
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });

    it('should track retry count on job items', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: () => Effect.void,
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: (id: string, updates: Partial<JobItem>) =>
                storage.update('jobItems', id, { ...updates, updatedAt: new Date() }),
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: () =>
                Effect.succeed({
                  total: 0,
                  pending: 0,
                  inProgress: 0,
                  complete: 0,
                  error: 0,
                }),
              updateJobStatus: () => Effect.void,
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        yield* jobService.createJobItems(job.id, ['bm-1']);

        const items = yield* jobService.getJobItems(job.id);
        const item = items[0];

        // First failure
        yield* jobService.updateJobItem(item.id, {
          status: 'error',
          retryCount: 1,
          errorMessage: 'First attempt failed',
        });

        let updated = (yield* jobService.getJobItems(job.id))[0];
        expect(updated.retryCount).toBe(1);

        // Second failure
        yield* jobService.updateJobItem(item.id, {
          status: 'error',
          retryCount: 2,
          errorMessage: 'Second attempt failed',
        });

        updated = (yield* jobService.getJobItems(job.id))[0];
        expect(updated.retryCount).toBe(2);
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });
  });

  describe('Job Cancellation', () => {
    it('should delete a job and its items', async () => {
      const storageService = createMockStorageService();
      const storageLayer = Layer.succeed(StorageService, storageService);
      const jobServiceLayer = Layer.provide(
        Layer.effect(
          JobService,
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return {
              createJob: (params: {
                type: JobType;
                status: JobStatus;
                parentJobId?: string;
                metadata?: Job['metadata'];
              }) =>
                Effect.gen(function* () {
                  const job: Job = {
                    id: crypto.randomUUID(),
                    type: params.type,
                    status: params.status,
                    parentJobId: params.parentJobId,
                    metadata: params.metadata ?? {},
                    createdAt: new Date(),
                  };
                  yield* storage.put('jobs', job.id, job);
                  return job;
                }),
              getRecentJobs: () => Effect.succeed([]),
              deleteJob: (jobId: string) => storage.delete('jobs', jobId),
              deleteBookmarkWithData: () => Effect.void,
              createJobItems: (jobId: string, bookmarkIds: readonly string[]) =>
                Effect.gen(function* () {
                  const now = new Date();
                  const items = bookmarkIds.map((bookmarkId) => ({
                    id: crypto.randomUUID(),
                    jobId,
                    bookmarkId,
                    status: 'pending' as JobItemStatus,
                    retryCount: 0,
                    createdAt: now,
                    updatedAt: now,
                  }));
                  yield* storage.bulkPut('jobItems', items);
                }),
              getJobItems: (jobId: string) =>
                storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }),
              getJobItemByBookmark: () => Effect.succeed(null),
              updateJobItem: () => Effect.void,
              updateJobItemByBookmark: () => Effect.void,
              getJobStats: () =>
                Effect.succeed({
                  total: 0,
                  pending: 0,
                  inProgress: 0,
                  complete: 0,
                  error: 0,
                }),
              updateJobStatus: () => Effect.void,
              retryFailedJobItems: () => Effect.succeed(0),
              retryBookmark: () => Effect.void,
            };
          })
        ),
        storageLayer
      );

      const program = Effect.gen(function* () {
        const jobService = yield* JobService;
        const job = yield* jobService.createJob({
          type: 'bulk_url_import',
          status: 'in_progress',
        });

        yield* jobService.createJobItems(job.id, ['bm-1', 'bm-2']);

        // Verify job exists
        expect(jobsStore.has(job.id)).toBe(true);
        let items = yield* jobService.getJobItems(job.id);
        expect(items).toHaveLength(2);

        // Delete job
        yield* jobService.deleteJob(job.id);

        // Verify job is deleted
        expect(jobsStore.has(job.id)).toBe(false);
      });

      await Effect.runPromise(program.pipe(Effect.provide(jobServiceLayer)));
    });
  });
});
