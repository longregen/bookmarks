/**
 * Retry utility with exponential backoff
 * Provides configurable retry logic for failed operations
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param attempt The current retry attempt (0-indexed)
 * @param baseDelayMs Base delay in milliseconds (e.g., 1000 for 1 second)
 * @param maxDelayMs Maximum delay in milliseconds (defaults to 30 seconds)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number = 30000
): number {
  // Exponential backoff: baseDelay * 2^attempt
  // For baseDelay=1000: 1s, 2s, 4s, 8s, 16s, 32s (capped at maxDelay)
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(exponentialDelay, maxDelayMs);
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param fn The async function to retry
 * @param options Retry options
 * @returns The result of the function or throws the last error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, onRetry } = options;
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this was the last attempt, throw the error
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Calculate delay for next retry
      const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!;
}

/**
 * Check if a bookmark should be retried based on retry count
 * @param retryCount Current retry count
 * @param maxRetries Maximum allowed retries
 * @returns true if bookmark should be retried, false otherwise
 */
export function shouldRetryBookmark(retryCount: number, maxRetries: number): boolean {
  return retryCount < maxRetries;
}

/**
 * Get the next retry time based on retry count and exponential backoff
 * @param retryCount Current retry count (0 for first retry)
 * @param baseDelayMs Base delay in milliseconds
 * @param maxDelayMs Maximum delay in milliseconds
 * @returns Date when the bookmark should be retried
 */
export function getNextRetryTime(
  retryCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): Date {
  const delay = calculateBackoffDelay(retryCount, baseDelayMs, maxDelayMs);
  return new Date(Date.now() + delay);
}
