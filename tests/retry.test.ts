import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sleep,
  calculateBackoffDelay,
  withRetry,
  shouldRetryBookmark,
  getNextRetryTime,
} from '../src/lib/retry';

describe('Retry Utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sleep', () => {
    it('should resolve after specified milliseconds', async () => {
      const sleepPromise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await sleepPromise;
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      const baseDelay = 1000; // 1 second

      // attempt 0: 1s * 2^0 = 1s
      expect(calculateBackoffDelay(0, baseDelay)).toBe(1000);

      // attempt 1: 1s * 2^1 = 2s
      expect(calculateBackoffDelay(1, baseDelay)).toBe(2000);

      // attempt 2: 1s * 2^2 = 4s
      expect(calculateBackoffDelay(2, baseDelay)).toBe(4000);

      // attempt 3: 1s * 2^3 = 8s
      expect(calculateBackoffDelay(3, baseDelay)).toBe(8000);

      // attempt 4: 1s * 2^4 = 16s
      expect(calculateBackoffDelay(4, baseDelay)).toBe(16000);
    });

    it('should respect maximum delay cap', () => {
      const baseDelay = 1000;
      const maxDelay = 8000;

      // attempt 3: 1s * 2^3 = 8s (at max)
      expect(calculateBackoffDelay(3, baseDelay, maxDelay)).toBe(8000);

      // attempt 4: 1s * 2^4 = 16s (capped at 8s)
      expect(calculateBackoffDelay(4, baseDelay, maxDelay)).toBe(8000);

      // attempt 5: 1s * 2^5 = 32s (capped at 8s)
      expect(calculateBackoffDelay(5, baseDelay, maxDelay)).toBe(8000);
    });

    it('should use default max delay of 30 seconds', () => {
      const baseDelay = 1000;

      // attempt 10: 1s * 2^10 = 1024s (capped at 30s)
      expect(calculateBackoffDelay(10, baseDelay)).toBe(30000);
    });

    it('should handle different base delays', () => {
      // Base delay of 500ms
      expect(calculateBackoffDelay(0, 500)).toBe(500);
      expect(calculateBackoffDelay(1, 500)).toBe(1000);
      expect(calculateBackoffDelay(2, 500)).toBe(2000);

      // Base delay of 2000ms
      expect(calculateBackoffDelay(0, 2000)).toBe(2000);
      expect(calculateBackoffDelay(1, 2000)).toBe(4000);
      expect(calculateBackoffDelay(2, 2000)).toBe(8000);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const onRetry = vi.fn();

      const result = await withRetry(mockFn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        onRetry,
      });

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      const resultPromise = withRetry(mockFn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        onRetry,
      });

      // First attempt fails, wait 1s
      await vi.advanceTimersByTimeAsync(1000);

      // Second attempt fails, wait 2s
      await vi.advanceTimersByTimeAsync(2000);

      // Third attempt succeeds
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
    });

    it('should throw error after max retries exceeded', async () => {
      const lastError = new Error('Final attempt failed');
      const mockFn = vi.fn().mockRejectedValue(lastError);

      const onRetry = vi.fn();

      // Don't await the promise immediately - we need to advance timers first
      const resultPromise = withRetry(mockFn, {
        maxRetries: 2, // 1 initial + 2 retries = 3 total attempts
        baseDelayMs: 1000,
        onRetry,
      });

      // Add a catch to prevent unhandled rejection
      resultPromise.catch(() => {
        // Expected to fail
      });

      // First retry after 1s
      await vi.advanceTimersByTimeAsync(1000);

      // Second retry after 2s
      await vi.advanceTimersByTimeAsync(2000);

      await expect(resultPromise).rejects.toThrow('Final attempt failed');
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error exceptions', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce('string error')
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      const resultPromise = withRetry(mockFn, {
        maxRetries: 1,
        baseDelayMs: 1000,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(result).toBe('success');
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should respect custom max delay', async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(mockFn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      });

      // First retry: 1s
      await vi.advanceTimersByTimeAsync(1000);

      // Second retry: 2s
      await vi.advanceTimersByTimeAsync(2000);

      // Third retry: 4s
      await vi.advanceTimersByTimeAsync(4000);

      const result = await resultPromise;
      expect(result).toBe('success');
    });
  });

  describe('shouldRetryBookmark', () => {
    it('should return true if retry count is below max', () => {
      expect(shouldRetryBookmark(0, 3)).toBe(true);
      expect(shouldRetryBookmark(1, 3)).toBe(true);
      expect(shouldRetryBookmark(2, 3)).toBe(true);
    });

    it('should return false if retry count equals or exceeds max', () => {
      expect(shouldRetryBookmark(3, 3)).toBe(false);
      expect(shouldRetryBookmark(4, 3)).toBe(false);
      expect(shouldRetryBookmark(5, 3)).toBe(false);
    });

    it('should work with different max retry values', () => {
      expect(shouldRetryBookmark(0, 1)).toBe(true);
      expect(shouldRetryBookmark(1, 1)).toBe(false);

      expect(shouldRetryBookmark(0, 5)).toBe(true);
      expect(shouldRetryBookmark(4, 5)).toBe(true);
      expect(shouldRetryBookmark(5, 5)).toBe(false);
    });
  });

  describe('getNextRetryTime', () => {
    beforeEach(() => {
      // Set a fixed time for testing
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    it('should calculate next retry time with exponential backoff', () => {
      const baseDelay = 1000;

      // Retry 0: current time + 1s
      const retry0 = getNextRetryTime(0, baseDelay);
      expect(retry0.getTime()).toBe(new Date('2024-01-01T00:00:01Z').getTime());

      // Retry 1: current time + 2s
      const retry1 = getNextRetryTime(1, baseDelay);
      expect(retry1.getTime()).toBe(new Date('2024-01-01T00:00:02Z').getTime());

      // Retry 2: current time + 4s
      const retry2 = getNextRetryTime(2, baseDelay);
      expect(retry2.getTime()).toBe(new Date('2024-01-01T00:00:04Z').getTime());

      // Retry 3: current time + 8s
      const retry3 = getNextRetryTime(3, baseDelay);
      expect(retry3.getTime()).toBe(new Date('2024-01-01T00:00:08Z').getTime());
    });

    it('should respect max delay', () => {
      const baseDelay = 1000;
      const maxDelay = 5000;

      // Retry 10: would be 1024s, but capped at 5s
      const retry10 = getNextRetryTime(10, baseDelay, maxDelay);
      expect(retry10.getTime()).toBe(new Date('2024-01-01T00:00:05Z').getTime());
    });

    it('should use default values correctly', () => {
      // Default baseDelay: 1000ms, maxDelay: 30000ms
      const retry0 = getNextRetryTime(0);
      expect(retry0.getTime()).toBe(new Date('2024-01-01T00:00:01Z').getTime());
    });

    it('should handle custom base delay', () => {
      const baseDelay = 2000;

      // Retry 0: current time + 2s
      const retry0 = getNextRetryTime(0, baseDelay);
      expect(retry0.getTime()).toBe(new Date('2024-01-01T00:00:02Z').getTime());

      // Retry 1: current time + 4s
      const retry1 = getNextRetryTime(1, baseDelay);
      expect(retry1.getTime()).toBe(new Date('2024-01-01T00:00:04Z').getTime());
    });
  });
});
