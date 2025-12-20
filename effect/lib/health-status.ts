import { Context, Effect, Data, Layer } from 'effect';
import { JobStatus } from '../db/schema';
import { StorageError } from './errors';

// ============================================================================
// Types
// ============================================================================

/**
 * System health state enumeration
 */
export type HealthState = 'healthy' | 'processing' | 'idle' | 'error';

/**
 * Health status response with state, message, and job counts
 */
export interface HealthStatus {
  readonly state: HealthState;
  readonly message: string;
  readonly details?: {
    readonly pendingCount: number;
    readonly inProgressCount: number;
    readonly failedCount: number;
  };
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when health check fails
 */
export class HealthCheckError extends Data.TaggedError('HealthCheckError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Storage Service Interface
// ============================================================================

/**
 * Minimal storage service interface needed for health checks
 * The full StorageService will be defined in a separate module
 */
export interface StorageServiceForHealth {
  readonly queryCount: (
    table: string,
    filter: { field?: string; operator?: string; value?: unknown }
  ) => Effect.Effect<number, StorageError>;
}

/**
 * Storage service tag for dependency injection
 * Renamed to HealthStorageService to avoid naming collision with other storage services
 */
export class HealthStorageService extends Context.Tag('HealthStorageService')<
  HealthStorageService,
  StorageServiceForHealth
>() {}

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Health status service for monitoring system state
 */
export class HealthStatusService extends Context.Tag('HealthStatusService')<
  HealthStatusService,
  {
    readonly getHealthStatus: () => Effect.Effect<HealthStatus, HealthCheckError>;
  }
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Creates a health status service implementation
 */
const makeHealthStatusService = Effect.gen(function* () {
  const storage = yield* HealthStorageService;

  return {
    getHealthStatus: () =>
      Effect.gen(function* () {
        // Query job counts in parallel
        const [pendingCount, inProgressCount, failedCount, totalCount] = yield* Effect.all([
          storage.queryCount('jobs', {
            field: 'status',
            operator: 'eq',
            value: 'pending' satisfies JobStatus,
          }),
          storage.queryCount('jobs', {
            field: 'status',
            operator: 'eq',
            value: 'in_progress' satisfies JobStatus,
          }),
          storage.queryCount('jobs', {
            field: 'status',
            operator: 'eq',
            value: 'failed' satisfies JobStatus,
          }),
          storage.queryCount('jobs', {}),
        ]).pipe(
          Effect.mapError(
            (error) =>
              new HealthCheckError({
                message: 'Failed to query job counts',
                cause: error,
              })
          )
        );

        const details = { pendingCount, inProgressCount, failedCount };

        // Determine health state based on job counts
        if (failedCount > 0) {
          return {
            state: 'error' as const,
            message: `${failedCount} failed job${failedCount !== 1 ? 's' : ''} need${failedCount === 1 ? 's' : ''} attention`,
            details,
          };
        }

        if (pendingCount > 0 || inProgressCount > 0) {
          const total = pendingCount + inProgressCount;
          return {
            state: 'processing' as const,
            message: `Processing ${total} job${total !== 1 ? 's' : ''}`,
            details,
          };
        }

        if (totalCount === 0) {
          return {
            state: 'idle' as const,
            message: 'No jobs in queue',
            details,
          };
        }

        return {
          state: 'healthy' as const,
          message: 'All systems healthy',
          details,
        };
      }),
  };
});

// ============================================================================
// Layer
// ============================================================================

/**
 * Layer that provides the HealthStatusService implementation
 * Requires StorageService to be provided
 */
export const HealthStatusServiceLive: Layer.Layer<
  HealthStatusService,
  never,
  HealthStorageService
> = Layer.effect(HealthStatusService, makeHealthStatusService);

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Standalone function to get health status
 * Requires StorageService to be provided in the context
 */
export const getHealthStatus = (): Effect.Effect<
  HealthStatus,
  HealthCheckError,
  HealthStatusService
> =>
  Effect.gen(function* () {
    const service = yield* HealthStatusService;
    return yield* service.getHealthStatus();
  });

/**
 * Get health status with storage service directly injected
 * Useful for one-off checks without full service layer
 */
export const getHealthStatusWithStorage = (
  storage: StorageServiceForHealth
): Effect.Effect<HealthStatus, HealthCheckError> => {
  const storageLayer = Layer.succeed(HealthStorageService, storage);
  const healthLayer = HealthStatusServiceLive.pipe(Layer.provide(storageLayer));

  return getHealthStatus().pipe(Effect.provide(healthLayer));
};
