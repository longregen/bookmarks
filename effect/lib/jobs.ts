import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type {
  Job,
  JobItem,
  JobType,
  JobStatus,
  JobItemStatus,
  Bookmark,
  BookmarkStatus,
  TableName,
} from '../db/schema';
import { RepositoryError, StorageError } from './errors';

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type {
  Job,
  JobItem,
  JobType,
  JobStatus,
  JobItemStatus,
};

// ============================================================================
// Storage Service Interface
// ============================================================================

/**
 * Generic storage service interface for database operations
 * This is the minimal interface needed by JobService
 */
export interface IStorageService {
  readonly get: <T>(
    table: TableName,
    key: string
  ) => Effect.Effect<T | null, StorageError>;

  readonly put: <T>(
    table: TableName,
    key: string,
    value: T
  ) => Effect.Effect<void, StorageError>;

  readonly delete: (
    table: TableName,
    key: string
  ) => Effect.Effect<void, StorageError>;

  readonly bulkPut: <T>(
    table: TableName,
    items: readonly T[]
  ) => Effect.Effect<void, StorageError>;

  readonly bulkDelete: (
    table: TableName,
    keys: readonly string[]
  ) => Effect.Effect<void, StorageError>;

  readonly query: <T>(
    table: TableName,
    filter: QueryFilter
  ) => Effect.Effect<readonly T[], StorageError>;

  readonly update: <T>(
    table: TableName,
    key: string,
    updates: Partial<T>
  ) => Effect.Effect<void, StorageError>;

  readonly bulkUpdate: <T>(
    table: TableName,
    updates: readonly { key: string; changes: Partial<T> }[]
  ) => Effect.Effect<void, StorageError>;
}

/**
 * Query filter for database operations
 */
export interface QueryFilter {
  readonly field?: string;
  readonly operator?: 'eq' | 'contains' | 'in' | 'gte' | 'lte' | 'range';
  readonly value?: unknown;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: readonly { field: string; direction: 'asc' | 'desc' }[];
}

/**
 * Storage service tag for dependency injection
 */
export class StorageService extends Context.Tag('JobsStorageService')<
  StorageService,
  IStorageService
>() {}

// ============================================================================
// Job Statistics Type
// ============================================================================

/**
 * Statistics for a job's execution progress
 */
export interface JobStats {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly complete: number;
  readonly error: number;
}

// ============================================================================
// Job Service Interface
// ============================================================================

/**
 * Service for managing background jobs and job items
 */
export class JobService extends Context.Tag('JobService')<
  JobService,
  {
    /**
     * Create a new job
     */
    readonly createJob: (params: {
      type: JobType;
      status: JobStatus;
      parentJobId?: string;
      metadata?: Job['metadata'];
    }) => Effect.Effect<Job, RepositoryError>;

    /**
     * Get recent jobs with optional filters
     */
    readonly getRecentJobs: (options?: {
      limit?: number;
      type?: JobType;
      status?: JobStatus;
      parentJobId?: string;
    }) => Effect.Effect<readonly Job[], RepositoryError>;

    /**
     * Delete a job by ID
     */
    readonly deleteJob: (jobId: string) => Effect.Effect<void, RepositoryError>;

    /**
     * Delete a bookmark and all associated data (markdown, Q&A, tags, job items)
     */
    readonly deleteBookmarkWithData: (
      bookmarkId: string
    ) => Effect.Effect<void, RepositoryError>;

    /**
     * Create job items for a job
     */
    readonly createJobItems: (
      jobId: string,
      bookmarkIds: readonly string[]
    ) => Effect.Effect<void, RepositoryError>;

    /**
     * Get all job items for a job
     */
    readonly getJobItems: (
      jobId: string
    ) => Effect.Effect<readonly JobItem[], RepositoryError>;

    /**
     * Get a job item by bookmark ID
     */
    readonly getJobItemByBookmark: (
      bookmarkId: string
    ) => Effect.Effect<JobItem | null, RepositoryError>;

    /**
     * Update a job item by ID
     */
    readonly updateJobItem: (
      id: string,
      updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
    ) => Effect.Effect<void, RepositoryError>;

    /**
     * Update a job item by bookmark ID
     */
    readonly updateJobItemByBookmark: (
      bookmarkId: string,
      updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
    ) => Effect.Effect<void, RepositoryError>;

    /**
     * Get statistics for a job's execution progress
     */
    readonly getJobStats: (jobId: string) => Effect.Effect<JobStats, RepositoryError>;

    /**
     * Update job status based on job item statistics
     */
    readonly updateJobStatus: (jobId: string) => Effect.Effect<void, RepositoryError>;

    /**
     * Retry all failed job items for a job
     * Returns the number of items retried
     */
    readonly retryFailedJobItems: (
      jobId: string
    ) => Effect.Effect<number, RepositoryError>;

    /**
     * Retry a single bookmark
     */
    readonly retryBookmark: (
      bookmarkId: string
    ) => Effect.Effect<void, RepositoryError>;
  }
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Create the JobService implementation
 */
const makeJobService = Effect.gen(function* () {
  const storage = yield* StorageService;

  return {
    createJob: (params: {
      type: JobType;
      status: JobStatus;
      parentJobId?: string;
      metadata?: Job['metadata'];
    }): Effect.Effect<Job, RepositoryError> =>
      Effect.gen(function* () {
        const job: Job = {
          id: crypto.randomUUID(),
          type: params.type,
          status: params.status,
          parentJobId: params.parentJobId,
          metadata: params.metadata ?? {},
          createdAt: new Date(),
        };

        yield* storage.put('jobs', job.id, job).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: 'UNKNOWN',
                entity: 'Job',
                operation: 'create',
                message: `Failed to create job: ${error.message}`,
                originalError: error,
              })
          )
        );

        return job;
      }),

    getRecentJobs: (options?: {
      limit?: number;
      type?: JobType;
      status?: JobStatus;
      parentJobId?: string;
    }): Effect.Effect<readonly Job[], RepositoryError> =>
      Effect.gen(function* () {
        const limit = options?.limit ?? 100;

        // Use indexed queries when possible for better performance
        if (options?.parentJobId !== undefined) {
          let jobs = yield* storage
            .query<Job>('jobs', {
              field: 'parentJobId',
              operator: 'eq',
              value: options.parentJobId,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'Job',
                    operation: 'query',
                    message: `Failed to query jobs by parentJobId: ${error.message}`,
                    originalError: error,
                  })
              )
            );

          // Apply client-side filters
          if (options.type !== undefined) {
            jobs = jobs.filter((job) => job.type === options.type);
          }
          if (options.status !== undefined) {
            jobs = jobs.filter((job) => job.status === options.status);
          }

          // Sort and limit
          const sorted = [...jobs].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
          return sorted.slice(0, limit);
        }

        if (options?.status !== undefined) {
          let jobs = yield* storage
            .query<Job>('jobs', {
              field: 'status',
              operator: 'eq',
              value: options.status,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'Job',
                    operation: 'query',
                    message: `Failed to query jobs by status: ${error.message}`,
                    originalError: error,
                  })
              )
            );

          if (options.type !== undefined) {
            jobs = jobs.filter((job) => job.type === options.type);
          }

          const sorted = [...jobs].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
          return sorted.slice(0, limit);
        }

        if (options?.type !== undefined) {
          const jobs = yield* storage
            .query<Job>('jobs', {
              field: 'type',
              operator: 'eq',
              value: options.type,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'Job',
                    operation: 'query',
                    message: `Failed to query jobs by type: ${error.message}`,
                    originalError: error,
                  })
              )
            );

          const sorted = [...jobs].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
          return sorted.slice(0, limit);
        }

        // No filters - get all jobs sorted by createdAt
        return yield* storage
          .query<Job>('jobs', {
            sort: [{ field: 'createdAt', direction: 'desc' }],
            limit,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'Job',
                  operation: 'query',
                  message: `Failed to query jobs: ${error.message}`,
                  originalError: error,
                })
            )
          );
      }),

    deleteJob: (jobId: string): Effect.Effect<void, RepositoryError> =>
      storage.delete('jobs', jobId).pipe(
        Effect.mapError(
          (error) =>
            new RepositoryError({
              code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
              entity: 'Job',
              operation: 'delete',
              message: `Failed to delete job: ${error.message}`,
              originalError: error,
            })
        )
      ),

    deleteBookmarkWithData: (
      bookmarkId: string
    ): Effect.Effect<void, RepositoryError> =>
      Effect.gen(function* () {
        // Delete all associated data in parallel
        yield* Effect.all(
          [
            storage
              .query<{ id: string }>('markdown', {
                field: 'bookmarkId',
                operator: 'eq',
                value: bookmarkId,
              })
              .pipe(
                Effect.flatMap((items) =>
                  storage.bulkDelete(
                    'markdown',
                    items.map((item) => item.id)
                  )
                )
              ),
            storage
              .query<{ id: string }>('questionsAnswers', {
                field: 'bookmarkId',
                operator: 'eq',
                value: bookmarkId,
              })
              .pipe(
                Effect.flatMap((items) =>
                  storage.bulkDelete(
                    'questionsAnswers',
                    items.map((item) => item.id)
                  )
                )
              ),
            storage
              .query<{ bookmarkId: string; tagName: string }>('bookmarkTags', {
                field: 'bookmarkId',
                operator: 'eq',
                value: bookmarkId,
              })
              .pipe(
                Effect.flatMap((items) =>
                  storage.bulkDelete(
                    'bookmarkTags',
                    items.map((item) => `${item.bookmarkId}-${item.tagName}`)
                  )
                )
              ),
            storage
              .query<{ id: string }>('jobItems', {
                field: 'bookmarkId',
                operator: 'eq',
                value: bookmarkId,
              })
              .pipe(
                Effect.flatMap((items) =>
                  storage.bulkDelete(
                    'jobItems',
                    items.map((item) => item.id)
                  )
                )
              ),
          ],
          { concurrency: 'unbounded' }
        ).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: 'UNKNOWN',
                entity: 'Bookmark',
                operation: 'delete',
                message: `Failed to delete bookmark associated data: ${error instanceof Error ? error.message : String(error)}`,
                originalError: error,
              })
          )
        );

        // Finally delete the bookmark itself
        yield* storage.delete('bookmarks', bookmarkId).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                entity: 'Bookmark',
                operation: 'delete',
                message: `Failed to delete bookmark: ${error.message}`,
                originalError: error,
              })
          )
        );
      }),

    createJobItems: (
      jobId: string,
      bookmarkIds: readonly string[]
    ): Effect.Effect<void, RepositoryError> =>
      Effect.gen(function* () {
        const now = new Date();
        const jobItems: JobItem[] = bookmarkIds.map((bookmarkId) => ({
          id: crypto.randomUUID(),
          jobId,
          bookmarkId,
          status: 'pending' as JobItemStatus,
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        }));

        yield* storage.bulkPut('jobItems', jobItems).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: 'UNKNOWN',
                entity: 'JobItem',
                operation: 'create',
                message: `Failed to create job items: ${error.message}`,
                originalError: error,
              })
          )
        );
      }),

    getJobItems: (jobId: string): Effect.Effect<readonly JobItem[], RepositoryError> =>
      storage.query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId }).pipe(
        Effect.mapError(
          (error) =>
            new RepositoryError({
              code: 'UNKNOWN',
              entity: 'JobItem',
              operation: 'query',
              message: `Failed to get job items: ${error.message}`,
              originalError: error,
            })
        )
      ),

    getJobItemByBookmark: (
      bookmarkId: string
    ): Effect.Effect<JobItem | null, RepositoryError> =>
      Effect.gen(function* () {
        const items = yield* storage
          .query<JobItem>('jobItems', {
            field: 'bookmarkId',
            operator: 'eq',
            value: bookmarkId,
            limit: 1,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'query',
                  message: `Failed to get job item by bookmark: ${error.message}`,
                  originalError: error,
                })
            )
          );

        return items[0] ?? null;
      }),

    updateJobItem: (
      id: string,
      updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
    ): Effect.Effect<void, RepositoryError> =>
      storage
        .update<JobItem>('jobItems', id, {
          ...updates,
          updatedAt: new Date(),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                entity: 'JobItem',
                operation: 'update',
                message: `Failed to update job item: ${error.message}`,
                originalError: error,
              })
          )
        ),

    updateJobItemByBookmark: (
      bookmarkId: string,
      updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
    ): Effect.Effect<void, RepositoryError> =>
      Effect.gen(function* () {
        const jobItem = yield* storage
          .query<JobItem>('jobItems', {
            field: 'bookmarkId',
            operator: 'eq',
            value: bookmarkId,
            limit: 1,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'query',
                  message: `Failed to get job item by bookmark: ${error.message}`,
                  originalError: error,
                })
            )
          );

        if (jobItem[0]) {
          yield* storage
            .update<JobItem>('jobItems', jobItem[0].id, {
              ...updates,
              updatedAt: new Date(),
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'JobItem',
                    operation: 'update',
                    message: `Failed to update job item by bookmark: ${error.message}`,
                    originalError: error,
                  })
              )
            );
        }
      }),

    getJobStats: (jobId: string): Effect.Effect<JobStats, RepositoryError> =>
      Effect.gen(function* () {
        const items = yield* storage
          .query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'query',
                  message: `Failed to get job items for stats: ${error.message}`,
                  originalError: error,
                })
            )
          );

        const stats = items.reduce<Record<string, number>>(
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

    updateJobStatus: (jobId: string): Effect.Effect<void, RepositoryError> =>
      Effect.gen(function* () {
        const stats = yield* Effect.gen(function* () {
          const items = yield* storage
            .query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'JobItem',
                    operation: 'query',
                    message: `Failed to get job items for status update: ${error.message}`,
                    originalError: error,
                  })
              )
            );

          const statCounts = items.reduce<Record<string, number>>(
            (acc, item) => {
              acc[item.status]++;
              return acc;
            },
            { pending: 0, in_progress: 0, complete: 0, error: 0 }
          );

          return {
            total: items.length,
            pending: statCounts.pending,
            inProgress: statCounts.in_progress,
            complete: statCounts.complete,
            error: statCounts.error,
          };
        });

        let status: JobStatus;

        if (stats.total === 0) {
          status = 'completed';
        } else if (stats.complete === stats.total) {
          status = 'completed';
        } else if (stats.error > 0 && stats.pending === 0 && stats.inProgress === 0) {
          // All items are either complete or error, and at least one error
          status = stats.complete > 0 ? 'completed' : 'failed';
        } else if (stats.inProgress > 0 || stats.pending > 0) {
          status = 'in_progress';
        } else {
          status = 'completed';
        }

        yield* storage.update<Job>('jobs', jobId, { status }).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                entity: 'Job',
                operation: 'update',
                message: `Failed to update job status: ${error.message}`,
                originalError: error,
              })
          )
        );
      }),

    retryFailedJobItems: (jobId: string): Effect.Effect<number, RepositoryError> =>
      Effect.gen(function* () {
        const items = yield* storage
          .query<JobItem>('jobItems', {
            field: 'jobId',
            operator: 'eq',
            value: jobId,
          })
          .pipe(
            Effect.flatMap((allItems) =>
              Effect.succeed(allItems.filter((item) => item.status === 'error'))
            ),
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'query',
                  message: `Failed to query failed job items: ${error.message}`,
                  originalError: error,
                })
            )
          );

        if (items.length === 0) {
          return 0;
        }

        const now = new Date();
        const bookmarkIds = items.map((item) => item.bookmarkId);

        // Batch update all job items
        yield* storage
          .bulkUpdate<JobItem>(
            'jobItems',
            items.map((item) => ({
              key: item.id,
              changes: {
                status: 'pending' as JobItemStatus,
                retryCount: 0,
                errorMessage: undefined,
                updatedAt: now,
              },
            }))
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'update',
                  message: `Failed to update failed job items: ${error.message}`,
                  originalError: error,
                })
            )
          );

        // Batch update all bookmarks
        yield* storage
          .bulkUpdate<Bookmark>(
            'bookmarks',
            bookmarkIds.map((bookmarkId) => ({
              key: bookmarkId,
              changes: {
                status: 'fetching' as BookmarkStatus,
                errorMessage: undefined,
                retryCount: 0,
                updatedAt: now,
              },
            }))
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'Bookmark',
                  operation: 'update',
                  message: `Failed to update bookmarks for retry: ${error.message}`,
                  originalError: error,
                })
            )
          );

        // Update job status
        yield* Effect.gen(function* () {
          const stats = yield* Effect.gen(function* () {
            const allItems = yield* storage
              .query<JobItem>('jobItems', { field: 'jobId', operator: 'eq', value: jobId })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new RepositoryError({
                      code: 'UNKNOWN',
                      entity: 'JobItem',
                      operation: 'query',
                      message: `Failed to get job items for status update: ${error.message}`,
                      originalError: error,
                    })
                )
              );

            const statCounts = allItems.reduce<Record<string, number>>(
              (acc, item) => {
                acc[item.status]++;
                return acc;
              },
              { pending: 0, in_progress: 0, complete: 0, error: 0 }
            );

            return {
              total: allItems.length,
              pending: statCounts.pending,
              inProgress: statCounts.in_progress,
              complete: statCounts.complete,
              error: statCounts.error,
            };
          });

          let status: JobStatus;

          if (stats.total === 0) {
            status = 'completed';
          } else if (stats.complete === stats.total) {
            status = 'completed';
          } else if (stats.error > 0 && stats.pending === 0 && stats.inProgress === 0) {
            status = stats.complete > 0 ? 'completed' : 'failed';
          } else if (stats.inProgress > 0 || stats.pending > 0) {
            status = 'in_progress';
          } else {
            status = 'completed';
          }

          yield* storage.update<Job>('jobs', jobId, { status }).pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                  entity: 'Job',
                  operation: 'update',
                  message: `Failed to update job status: ${error.message}`,
                  originalError: error,
                })
            )
          );
        });

        return items.length;
      }),

    retryBookmark: (bookmarkId: string): Effect.Effect<void, RepositoryError> =>
      Effect.gen(function* () {
        const now = new Date();

        // Reset the bookmark
        yield* storage
          .update<Bookmark>('bookmarks', bookmarkId, {
            status: 'fetching' as BookmarkStatus,
            errorMessage: undefined,
            retryCount: 0,
            updatedAt: now,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                  entity: 'Bookmark',
                  operation: 'update',
                  message: `Failed to update bookmark for retry: ${error.message}`,
                  originalError: error,
                })
            )
          );

        // Reset the job item if exists
        const jobItem = yield* storage
          .query<JobItem>('jobItems', {
            field: 'bookmarkId',
            operator: 'eq',
            value: bookmarkId,
            limit: 1,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new RepositoryError({
                  code: 'UNKNOWN',
                  entity: 'JobItem',
                  operation: 'query',
                  message: `Failed to get job item for retry: ${error.message}`,
                  originalError: error,
                })
            )
          );

        if (jobItem[0]) {
          yield* storage
            .update<JobItem>('jobItems', jobItem[0].id, {
              status: 'pending' as JobItemStatus,
              retryCount: 0,
              errorMessage: undefined,
              updatedAt: now,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: 'UNKNOWN',
                    entity: 'JobItem',
                    operation: 'update',
                    message: `Failed to update job item for retry: ${error.message}`,
                    originalError: error,
                  })
              )
            );

          // Update the job status
          yield* Effect.gen(function* () {
            const stats = yield* Effect.gen(function* () {
              const items = yield* storage
                .query<JobItem>('jobItems', {
                  field: 'jobId',
                  operator: 'eq',
                  value: jobItem[0].jobId,
                })
                .pipe(
                  Effect.mapError(
                    (error) =>
                      new RepositoryError({
                        code: 'UNKNOWN',
                        entity: 'JobItem',
                        operation: 'query',
                        message: `Failed to get job items for status update: ${error.message}`,
                        originalError: error,
                      })
                  )
                );

              const statCounts = items.reduce<Record<string, number>>(
                (acc, item) => {
                  acc[item.status]++;
                  return acc;
                },
                { pending: 0, in_progress: 0, complete: 0, error: 0 }
              );

              return {
                total: items.length,
                pending: statCounts.pending,
                inProgress: statCounts.in_progress,
                complete: statCounts.complete,
                error: statCounts.error,
              };
            });

            let status: JobStatus;

            if (stats.total === 0) {
              status = 'completed';
            } else if (stats.complete === stats.total) {
              status = 'completed';
            } else if (stats.error > 0 && stats.pending === 0 && stats.inProgress === 0) {
              status = stats.complete > 0 ? 'completed' : 'failed';
            } else if (stats.inProgress > 0 || stats.pending > 0) {
              status = 'in_progress';
            } else {
              status = 'completed';
            }

            yield* storage.update<Job>('jobs', jobItem[0].jobId, { status }).pipe(
              Effect.mapError(
                (error) =>
                  new RepositoryError({
                    code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNKNOWN',
                    entity: 'Job',
                    operation: 'update',
                    message: `Failed to update job status: ${error.message}`,
                    originalError: error,
                  })
              )
            );
          });
        }
      }),
  };
});

// ============================================================================
// Layer
// ============================================================================

/**
 * Live layer that provides JobService implementation
 * Requires StorageService to be provided
 */
export const JobServiceLive: Layer.Layer<JobService, never, StorageService> =
  Layer.effect(JobService, makeJobService);

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a new job
 */
export const createJob = (params: {
  type: JobType;
  status: JobStatus;
  parentJobId?: string;
  metadata?: Job['metadata'];
}): Effect.Effect<Job, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.createJob(params);
  });

/**
 * Get recent jobs with optional filters
 */
export const getRecentJobs = (options?: {
  limit?: number;
  type?: JobType;
  status?: JobStatus;
  parentJobId?: string;
}): Effect.Effect<readonly Job[], RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.getRecentJobs(options);
  });

/**
 * Delete a job by ID
 */
export const deleteJob = (
  jobId: string
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.deleteJob(jobId);
  });

/**
 * Delete a bookmark and all associated data
 */
export const deleteBookmarkWithData = (
  bookmarkId: string
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.deleteBookmarkWithData(bookmarkId);
  });

/**
 * Create job items for a job
 */
export const createJobItems = (
  jobId: string,
  bookmarkIds: readonly string[]
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.createJobItems(jobId, bookmarkIds);
  });

/**
 * Get all job items for a job
 */
export const getJobItems = (
  jobId: string
): Effect.Effect<readonly JobItem[], RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.getJobItems(jobId);
  });

/**
 * Get a job item by bookmark ID
 */
export const getJobItemByBookmark = (
  bookmarkId: string
): Effect.Effect<JobItem | null, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.getJobItemByBookmark(bookmarkId);
  });

/**
 * Update a job item by ID
 */
export const updateJobItem = (
  id: string,
  updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.updateJobItem(id, updates);
  });

/**
 * Update a job item by bookmark ID
 */
export const updateJobItemByBookmark = (
  bookmarkId: string,
  updates: Partial<Pick<JobItem, 'status' | 'retryCount' | 'errorMessage'>>
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.updateJobItemByBookmark(bookmarkId, updates);
  });

/**
 * Get statistics for a job's execution progress
 */
export const getJobStats = (
  jobId: string
): Effect.Effect<JobStats, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.getJobStats(jobId);
  });

/**
 * Update job status based on job item statistics
 */
export const updateJobStatus = (
  jobId: string
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.updateJobStatus(jobId);
  });

/**
 * Retry all failed job items for a job
 */
export const retryFailedJobItems = (
  jobId: string
): Effect.Effect<number, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.retryFailedJobItems(jobId);
  });

/**
 * Retry a single bookmark
 */
export const retryBookmark = (
  bookmarkId: string
): Effect.Effect<void, RepositoryError, JobService> =>
  Effect.gen(function* () {
    const service = yield* JobService;
    return yield* service.retryBookmark(bookmarkId);
  });
