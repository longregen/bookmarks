/**
 * Retry and backoff utilities for Effect.ts
 */

export interface BackoffConfig {
  readonly baseDelay: number;
  readonly maxDelay: number;
}

/**
 * Calculate exponential backoff delay with jitter
 *
 * @param retryCount - Current retry attempt count (0-indexed)
 * @param config - Backoff configuration with baseDelay and maxDelay
 * @returns Delay in milliseconds with 25% jitter applied
 */
export function calculateBackoffDelay(
  retryCount: number,
  config: BackoffConfig
): number {
  const delay = Math.min(
    config.baseDelay * Math.pow(2, retryCount),
    config.maxDelay
  );
  return delay + Math.random() * delay * 0.25;
}
