import { getErrorMessage } from './errors';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs = 30000
): number {
  const exponentialDelay = baseDelayMs * (2 ** attempt);
  return Math.min(exponentialDelay, maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, onRetry } = options;
  let lastError: Error = new Error('Retry failed: all attempts exhausted');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(getErrorMessage(error));

      if (attempt >= maxRetries) {
        throw lastError;
      }

      const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

export function shouldRetryBookmark(retryCount: number, maxRetries: number): boolean {
  return retryCount < maxRetries;
}

export function getNextRetryTime(
  retryCount: number,
  baseDelayMs = 1000,
  maxDelayMs = 30000
): Date {
  const delay = calculateBackoffDelay(retryCount, baseDelayMs, maxDelayMs);
  return new Date(Date.now() + delay);
}
