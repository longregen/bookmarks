/**
 * Retry utility with exponential backoff
 * Provides shared retry logic for error recovery across the extension
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 60000, // 60 seconds
  backoffMultiplier: 2,
};

/**
 * Calculate exponential backoff delay
 * @param retryCount Current retry attempt (0-indexed)
 * @param config Retry configuration
 * @returns Delay in milliseconds before next retry
 */
export function calculateBackoff(
  retryCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, retryCount);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Error categories for determining retry behavior
 */
export enum ErrorCategory {
  RETRYABLE = 'retryable',     // Temporary errors that may succeed on retry
  FATAL = 'fatal',             // Permanent errors that won't succeed on retry
  UNKNOWN = 'unknown',         // Unknown errors - treat as retryable by default
}

/**
 * Categorize an error to determine if it's retryable
 * @param error Error object or message
 * @returns Error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (!error) {
    return ErrorCategory.UNKNOWN;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorString = errorMessage.toLowerCase();

  // Network errors - retryable
  if (
    errorString.includes('network') ||
    errorString.includes('timeout') ||
    errorString.includes('econnrefused') ||
    errorString.includes('enotfound') ||
    errorString.includes('etimedout') ||
    errorString.includes('fetch failed') ||
    errorString.includes('connection') ||
    errorString.includes('socket') ||
    errorString.includes('offline')
  ) {
    return ErrorCategory.RETRYABLE;
  }

  // Rate limiting - retryable
  if (
    errorString.includes('rate limit') ||
    errorString.includes('too many requests') ||
    errorString.includes('429')
  ) {
    return ErrorCategory.RETRYABLE;
  }

  // Service unavailable - retryable
  if (
    errorString.includes('service unavailable') ||
    errorString.includes('503') ||
    errorString.includes('502') ||
    errorString.includes('504')
  ) {
    return ErrorCategory.RETRYABLE;
  }

  // Server errors (500) - retryable (may be temporary)
  if (errorString.includes('500') || errorString.includes('internal server error')) {
    return ErrorCategory.RETRYABLE;
  }

  // Client errors - fatal
  if (
    errorString.includes('400') ||
    errorString.includes('bad request') ||
    errorString.includes('401') ||
    errorString.includes('unauthorized') ||
    errorString.includes('403') ||
    errorString.includes('forbidden') ||
    errorString.includes('404') ||
    errorString.includes('not found') ||
    errorString.includes('invalid url') ||
    errorString.includes('invalid api key') ||
    errorString.includes('invalid request')
  ) {
    return ErrorCategory.FATAL;
  }

  // Parse/validation errors - fatal
  if (
    errorString.includes('parse error') ||
    errorString.includes('invalid json') ||
    errorString.includes('syntax error') ||
    errorString.includes('validation failed')
  ) {
    return ErrorCategory.FATAL;
  }

  // Default to retryable for unknown errors
  return ErrorCategory.UNKNOWN;
}

/**
 * Check if an error should be retried
 * @param error Error object or message
 * @param currentRetryCount Current retry attempt count
 * @param config Retry configuration
 * @returns True if should retry, false otherwise
 */
export function shouldRetry(
  error: unknown,
  currentRetryCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
  // Check if we've exceeded max retries
  if (currentRetryCount >= config.maxRetries) {
    return false;
  }

  // Check if error is retryable
  const category = categorizeError(error);
  if (category === ErrorCategory.FATAL) {
    return false;
  }

  // RETRYABLE and UNKNOWN errors should be retried
  return true;
}

/**
 * Sleep for a specified duration
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 * @param fn Function to execute
 * @param config Retry configuration
 * @param onRetry Optional callback called before each retry
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (error: unknown, retryCount: number, delayMs: number) => void | Promise<void>
): Promise<T> {
  let lastError: unknown;
  let retryCount = 0;

  while (retryCount <= config.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!shouldRetry(error, retryCount, config)) {
        throw error;
      }

      // Calculate backoff delay
      const delayMs = calculateBackoff(retryCount, config);

      // Call onRetry callback if provided
      if (onRetry) {
        await onRetry(error, retryCount, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      retryCount++;
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Get a human-readable description of the retry state
 * @param retryCount Current retry count
 * @param maxRetries Maximum retry count
 * @param error Optional error to categorize
 * @returns Description string
 */
export function getRetryDescription(
  retryCount: number,
  maxRetries: number,
  error?: unknown
): string {
  if (retryCount === 0) {
    return 'First attempt';
  }

  const category = error ? categorizeError(error) : ErrorCategory.UNKNOWN;
  const categoryText = category === ErrorCategory.FATAL ? '(fatal error)' : '';

  return `Retry ${retryCount}/${maxRetries} ${categoryText}`.trim();
}
