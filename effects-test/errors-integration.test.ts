import { describe, it, expect } from 'vitest';
import * as Effect from 'effect/Effect';
import {
  StorageError,
  RepositoryError,
  NetworkError,
  FetchError,
  ValidationError,
  JobQueueError,
  ProcessingError,
  EmbeddingError,
  SearchError,
  ConfigError,
  SyncError,
  ContentExtractionError,
  CriticalError,
  getErrorMessage,
  getErrorDetails,
  isRetryableError,
  shouldEscalateError,
} from '../effect/lib/errors';

describe('Error Handling Framework Integration', () => {
  describe('Error Creation with Context', () => {
    it('should create StorageError with full context', () => {
      const error = new StorageError({
        code: 'QUOTA_EXCEEDED',
        operation: 'write',
        table: 'bookmarks',
        message: 'Storage quota exceeded',
        originalError: new Error('Disk full'),
      });

      expect(error._tag).toBe('StorageError');
      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.operation).toBe('write');
      expect(error.table).toBe('bookmarks');
      expect(error.message).toBe('Storage quota exceeded');
      expect(error.originalError).toBeInstanceOf(Error);
    });

    it('should create RepositoryError with validation context', () => {
      const error = new RepositoryError({
        code: 'VALIDATION_FAILED',
        entity: 'Bookmark',
        operation: 'create',
        message: 'Invalid bookmark data',
        originalError: { field: 'url', reason: 'invalid format' },
      });

      expect(error._tag).toBe('RepositoryError');
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.entity).toBe('Bookmark');
      expect(error.operation).toBe('create');
    });

    it('should create NetworkError with status information', () => {
      const error = new NetworkError({
        url: 'https://example.com/api',
        status: 503,
        statusText: 'Service Unavailable',
        message: 'Network request failed',
      });

      expect(error._tag).toBe('NetworkError');
      expect(error.url).toBe('https://example.com/api');
      expect(error.status).toBe(503);
      expect(error.statusText).toBe('Service Unavailable');
    });

    it('should create FetchError with retry context', () => {
      const error = new FetchError({
        url: 'https://example.com/page',
        code: 'TIMEOUT',
        message: 'Request timeout after 30s',
        status: 408,
      });

      expect(error._tag).toBe('FetchError');
      expect(error.code).toBe('TIMEOUT');
      expect(error.url).toBe('https://example.com/page');
    });

    it('should create ValidationError with field details', () => {
      const error = new ValidationError({
        field: 'email',
        reason: 'Invalid email format',
        value: 'not-an-email',
        message: 'Email validation failed',
      });

      expect(error._tag).toBe('ValidationError');
      expect(error.field).toBe('email');
      expect(error.reason).toBe('Invalid email format');
      expect(error.value).toBe('not-an-email');
    });

    it('should create JobQueueError with retry count', () => {
      const error = new JobQueueError({
        jobId: 'job-123',
        code: 'MAX_RETRIES_EXCEEDED',
        message: 'Job failed after 5 retries',
        retryCount: 5,
      });

      expect(error._tag).toBe('JobQueueError');
      expect(error.jobId).toBe('job-123');
      expect(error.code).toBe('MAX_RETRIES_EXCEEDED');
      expect(error.retryCount).toBe(5);
    });

    it('should create ProcessingError with stage information', () => {
      const error = new ProcessingError({
        bookmarkId: 'bookmark-456',
        stage: 'embed',
        message: 'Embedding generation failed',
      });

      expect(error._tag).toBe('ProcessingError');
      expect(error.bookmarkId).toBe('bookmark-456');
      expect(error.stage).toBe('embed');
    });

    it('should create EmbeddingError with provider and rate limit info', () => {
      const error = new EmbeddingError({
        code: 'RATE_LIMITED',
        provider: 'openai',
        message: 'Rate limit exceeded',
        retryAfter: 60,
      });

      expect(error._tag).toBe('EmbeddingError');
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.provider).toBe('openai');
      expect(error.retryAfter).toBe(60);
    });

    it('should create SearchError with query context', () => {
      const error = new SearchError({
        code: 'QUERY_INVALID',
        query: 'malformed search term',
        message: 'Invalid search query syntax',
      });

      expect(error._tag).toBe('SearchError');
      expect(error.code).toBe('QUERY_INVALID');
      expect(error.query).toBe('malformed search term');
    });

    it('should create ConfigError with key information', () => {
      const error = new ConfigError({
        code: 'MISSING_REQUIRED',
        key: 'API_KEY',
        message: 'Required configuration missing',
      });

      expect(error._tag).toBe('ConfigError');
      expect(error.code).toBe('MISSING_REQUIRED');
      expect(error.key).toBe('API_KEY');
    });

    it('should create SyncError with operation context', () => {
      const error = new SyncError({
        code: 'AUTHENTICATION_FAILED',
        operation: 'authenticate',
        message: 'Invalid credentials',
      });

      expect(error._tag).toBe('SyncError');
      expect(error.code).toBe('AUTHENTICATION_FAILED');
      expect(error.operation).toBe('authenticate');
    });

    it('should create ContentExtractionError with URL', () => {
      const error = new ContentExtractionError({
        url: 'https://example.com/article',
        code: 'PARSE_FAILED',
        message: 'Failed to extract content',
      });

      expect(error._tag).toBe('ContentExtractionError');
      expect(error.url).toBe('https://example.com/article');
      expect(error.code).toBe('PARSE_FAILED');
    });

    it('should create CriticalError with additional context', () => {
      const error = new CriticalError({
        message: 'System failure',
        originalError: new Error('Database connection lost'),
        context: { timestamp: Date.now(), severity: 'high' },
      });

      expect(error._tag).toBe('CriticalError');
      expect(error.message).toBe('System failure');
      expect(error.context).toBeDefined();
      expect(error.context?.severity).toBe('high');
    });
  });

  describe('Error Catching by Tag', () => {
    it('should catch StorageError by tag', async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.fail(
          new StorageError({
            code: 'NOT_FOUND',
            operation: 'read',
            table: 'bookmarks',
            message: 'Record not found',
          })
        );
      }).pipe(
        Effect.catchTag('StorageError', (error) =>
          Effect.succeed(`Handled: ${error.message}`)
        )
      );

      const result = await Effect.runPromise(program);
      expect(result).toBe('Handled: Record not found');
    });

    it('should catch FetchError and handle retry logic', async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.fail(
          new FetchError({
            url: 'https://example.com',
            code: 'NETWORK_ERROR',
            message: 'Connection failed',
          })
        );
      }).pipe(
        Effect.catchTag('FetchError', (error) =>
          Effect.succeed({
            recovered: true,
            shouldRetry: error.code === 'NETWORK_ERROR',
          })
        )
      );

      const result = await Effect.runPromise(program);
      expect(result.recovered).toBe(true);
      expect(result.shouldRetry).toBe(true);
    });

    it('should catch ValidationError separately from other errors', async () => {
      const validationProgram = Effect.fail(
        new ValidationError({
          field: 'url',
          reason: 'invalid format',
          message: 'Validation failed',
        })
      ).pipe(
        Effect.catchTag('ValidationError', (error) =>
          Effect.succeed(`Validation error on field: ${error.field}`)
        )
      );

      const result = await Effect.runPromise(validationProgram);
      expect(result).toBe('Validation error on field: url');
    });

    it('should catch multiple error types with different handlers', async () => {
      const createError = (type: 'storage' | 'network') => {
        if (type === 'storage') {
          return Effect.fail(
            new StorageError({
              code: 'UNKNOWN',
              operation: 'read',
              table: 'test',
              message: 'Storage error',
            })
          );
        }
        return Effect.fail(
          new NetworkError({
            url: 'https://test.com',
            message: 'Network error',
          })
        );
      };

      const program = (errorType: 'storage' | 'network') =>
        createError(errorType).pipe(
          Effect.catchTag('StorageError', () => Effect.succeed('handled-storage')),
          Effect.catchTag('NetworkError', () => Effect.succeed('handled-network'))
        );

      const storageResult = await Effect.runPromise(program('storage'));
      const networkResult = await Effect.runPromise(program('network'));

      expect(storageResult).toBe('handled-storage');
      expect(networkResult).toBe('handled-network');
    });

    it('should use catchAll for untyped error handling', async () => {
      const program = Effect.gen(function* () {
        return yield* Effect.fail(
          new EmbeddingError({
            code: 'API_ERROR',
            provider: 'openai',
            message: 'API request failed',
          })
        );
      }).pipe(Effect.catchAll((error) => Effect.succeed({ caught: true, error })));

      const result = await Effect.runPromise(program);
      expect(result.caught).toBe(true);
      expect(result.error).toBeInstanceOf(EmbeddingError);
    });
  });

  describe('Error Cause Chain Preservation', () => {
    it('should preserve original error in cause chain', async () => {
      const originalError = new Error('Database connection failed');
      const storageError = new StorageError({
        code: 'TRANSACTION_FAILED',
        operation: 'transaction',
        table: 'bookmarks',
        message: 'Transaction rolled back',
        originalError,
      });

      expect(storageError.originalError).toBe(originalError);
    });

    it('should chain errors through multiple layers', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchError = new FetchError({
        url: 'https://api.example.com',
        code: 'NETWORK_ERROR',
        message: 'Failed to fetch',
        originalError: networkError,
      });

      const processingError = new ProcessingError({
        bookmarkId: 'test-123',
        stage: 'fetch',
        message: 'Bookmark processing failed',
        originalError: fetchError,
      });

      expect(processingError.originalError).toBe(fetchError);
      expect((processingError.originalError as FetchError).originalError).toBe(
        networkError
      );
    });

    it('should preserve error context through Effect operations', async () => {
      const originalError = new Error('Original cause');

      const program = Effect.gen(function* () {
        return yield* Effect.fail(
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'Bookmark',
            operation: 'query',
            message: 'Query failed',
            originalError,
          })
        );
      }).pipe(
        Effect.catchTag('RepositoryError', (error) =>
          Effect.fail(
            new ProcessingError({
              bookmarkId: 'test-456',
              stage: 'save',
              message: 'Failed to save after query error',
              originalError: error,
            })
          )
        )
      );

      const result = await Effect.runPromiseExit(program);
      if (result._tag === 'Failure') {
        const cause = result.cause;
        expect(cause._tag).toBe('Fail');
        if (cause._tag === 'Fail') {
          const error = cause.error as ProcessingError;
          expect(error).toBeInstanceOf(ProcessingError);
          expect(error.originalError).toBeInstanceOf(RepositoryError);
        }
      }
    });
  });

  describe('isRetryableError Helper', () => {
    it('should identify retryable FetchErrors', () => {
      const networkError = new FetchError({
        url: 'https://example.com',
        code: 'NETWORK_ERROR',
        message: 'Network error',
      });

      const timeoutError = new FetchError({
        url: 'https://example.com',
        code: 'TIMEOUT',
        message: 'Timeout',
      });

      const rateLimitError = new FetchError({
        url: 'https://example.com',
        code: 'RATE_LIMITED',
        message: 'Rate limited',
      });

      expect(isRetryableError(networkError)).toBe(true);
      expect(isRetryableError(timeoutError)).toBe(true);
      expect(isRetryableError(rateLimitError)).toBe(true);
    });

    it('should identify non-retryable FetchErrors', () => {
      const notFoundError = new FetchError({
        url: 'https://example.com',
        code: 'NOT_FOUND',
        message: 'Not found',
      });

      const forbiddenError = new FetchError({
        url: 'https://example.com',
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });

      expect(isRetryableError(notFoundError)).toBe(false);
      expect(isRetryableError(forbiddenError)).toBe(false);
    });

    it('should identify retryable EmbeddingErrors', () => {
      const rateLimitError = new EmbeddingError({
        code: 'RATE_LIMITED',
        provider: 'openai',
        message: 'Rate limited',
      });

      const apiError = new EmbeddingError({
        code: 'API_ERROR',
        provider: 'openai',
        message: 'API error',
      });

      expect(isRetryableError(rateLimitError)).toBe(true);
      expect(isRetryableError(apiError)).toBe(true);
    });

    it('should identify retryable SyncErrors', () => {
      const networkError = new SyncError({
        code: 'NETWORK_ERROR',
        operation: 'pull',
        message: 'Network error',
      });

      const conflictError = new SyncError({
        code: 'CONFLICT',
        operation: 'merge',
        message: 'Conflict',
      });

      expect(isRetryableError(networkError)).toBe(true);
      expect(isRetryableError(conflictError)).toBe(true);
    });

    it('should identify retryable NetworkErrors based on status', () => {
      const serverError = new NetworkError({
        url: 'https://example.com',
        status: 503,
        message: 'Service unavailable',
      });

      const notFound = new NetworkError({
        url: 'https://example.com',
        status: 404,
        message: 'Not found',
      });

      const forbidden = new NetworkError({
        url: 'https://example.com',
        status: 403,
        message: 'Forbidden',
      });

      expect(isRetryableError(serverError)).toBe(true);
      expect(isRetryableError(notFound)).toBe(false);
      expect(isRetryableError(forbidden)).toBe(false);
    });

    it('should not retry StorageErrors', () => {
      const error = new StorageError({
        code: 'NOT_FOUND',
        operation: 'read',
        table: 'bookmarks',
        message: 'Not found',
      });

      expect(isRetryableError(error)).toBe(false);
    });

    it('should not retry ValidationErrors', () => {
      const error = new ValidationError({
        field: 'url',
        reason: 'invalid',
        message: 'Validation failed',
      });

      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('shouldEscalateError Helper', () => {
    it('should escalate CriticalErrors', () => {
      const error = new CriticalError({
        message: 'Critical system error',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should escalate StorageError with QUOTA_EXCEEDED', () => {
      const error = new StorageError({
        code: 'QUOTA_EXCEEDED',
        operation: 'write',
        table: 'bookmarks',
        message: 'Quota exceeded',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should escalate StorageError with TRANSACTION_FAILED', () => {
      const error = new StorageError({
        code: 'TRANSACTION_FAILED',
        operation: 'transaction',
        table: 'bookmarks',
        message: 'Transaction failed',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should escalate RepositoryError with QUOTA_EXCEEDED', () => {
      const error = new RepositoryError({
        code: 'QUOTA_EXCEEDED',
        entity: 'Bookmark',
        operation: 'create',
        message: 'Quota exceeded',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should escalate EmbeddingError with QUOTA_EXCEEDED', () => {
      const error = new EmbeddingError({
        code: 'QUOTA_EXCEEDED',
        provider: 'openai',
        message: 'Quota exceeded',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should escalate SyncError with AUTHENTICATION_FAILED', () => {
      const error = new SyncError({
        code: 'AUTHENTICATION_FAILED',
        operation: 'authenticate',
        message: 'Authentication failed',
      });

      expect(shouldEscalateError(error)).toBe(true);
    });

    it('should not escalate normal errors', () => {
      const fetchError = new FetchError({
        url: 'https://example.com',
        code: 'NETWORK_ERROR',
        message: 'Network error',
      });

      const validationError = new ValidationError({
        field: 'url',
        reason: 'invalid',
        message: 'Validation error',
      });

      expect(shouldEscalateError(fetchError)).toBe(false);
      expect(shouldEscalateError(validationError)).toBe(false);
    });
  });

  describe('Error Serialization for Logging', () => {
    it('should extract message from Error instances', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it('should extract message from objects with message property', () => {
      const error = { message: 'Custom error message' };
      expect(getErrorMessage(error)).toBe('Custom error message');
    });

    it('should extract message from string errors', () => {
      expect(getErrorMessage('Simple error string')).toBe('Simple error string');
    });

    it('should convert unknown errors to string', () => {
      expect(getErrorMessage(42)).toBe('42');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should get details from StorageError', () => {
      const error = new StorageError({
        code: 'NOT_FOUND',
        operation: 'read',
        table: 'bookmarks',
        message: 'Record not found',
        originalError: new Error('DB error'),
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Record not found');
      expect(details.code).toBe('NOT_FOUND');
      expect(details.context).toBeDefined();
      expect(details.context?.operation).toBe('read');
      expect(details.context?.table).toBe('bookmarks');
    });

    it('should get details from RepositoryError', () => {
      const error = new RepositoryError({
        code: 'VALIDATION_FAILED',
        entity: 'Bookmark',
        operation: 'create',
        message: 'Validation failed',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Validation failed');
      expect(details.code).toBe('VALIDATION_FAILED');
      expect(details.context?.entity).toBe('Bookmark');
      expect(details.context?.operation).toBe('create');
    });

    it('should get details from NetworkError', () => {
      const error = new NetworkError({
        url: 'https://example.com',
        status: 503,
        statusText: 'Service Unavailable',
        message: 'Request failed',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Request failed');
      expect(details.code).toBe('NETWORK_ERROR');
      expect(details.context?.url).toBe('https://example.com');
      expect(details.context?.status).toBe(503);
    });

    it('should get details from FetchError', () => {
      const error = new FetchError({
        url: 'https://api.example.com',
        code: 'TIMEOUT',
        message: 'Request timeout',
        status: 408,
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Request timeout');
      expect(details.code).toBe('TIMEOUT');
      expect(details.context?.url).toBe('https://api.example.com');
      expect(details.context?.status).toBe(408);
    });

    it('should get details from ValidationError', () => {
      const error = new ValidationError({
        field: 'email',
        reason: 'invalid format',
        value: 'not-an-email',
        message: 'Email validation failed',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Email validation failed');
      expect(details.code).toBe('VALIDATION_ERROR');
      expect(details.context?.field).toBe('email');
      expect(details.context?.reason).toBe('invalid format');
      expect(details.context?.value).toBe('not-an-email');
    });

    it('should get details from JobQueueError', () => {
      const error = new JobQueueError({
        jobId: 'job-123',
        code: 'MAX_RETRIES_EXCEEDED',
        message: 'Job failed',
        retryCount: 5,
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Job failed');
      expect(details.code).toBe('MAX_RETRIES_EXCEEDED');
      expect(details.context?.jobId).toBe('job-123');
      expect(details.context?.retryCount).toBe(5);
    });

    it('should get details from ProcessingError', () => {
      const error = new ProcessingError({
        bookmarkId: 'bookmark-456',
        stage: 'embed',
        message: 'Processing failed',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Processing failed');
      expect(details.code).toBe('PROCESSING_ERROR');
      expect(details.context?.bookmarkId).toBe('bookmark-456');
      expect(details.context?.stage).toBe('embed');
    });

    it('should get details from EmbeddingError', () => {
      const error = new EmbeddingError({
        code: 'RATE_LIMITED',
        provider: 'openai',
        message: 'Rate limit exceeded',
        retryAfter: 60,
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Rate limit exceeded');
      expect(details.code).toBe('RATE_LIMITED');
      expect(details.context?.provider).toBe('openai');
      expect(details.context?.retryAfter).toBe(60);
    });

    it('should get details from SearchError', () => {
      const error = new SearchError({
        code: 'QUERY_INVALID',
        query: 'malformed query',
        message: 'Invalid search query',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Invalid search query');
      expect(details.code).toBe('QUERY_INVALID');
      expect(details.context?.query).toBe('malformed query');
    });

    it('should get details from ConfigError', () => {
      const error = new ConfigError({
        code: 'MISSING_REQUIRED',
        key: 'API_KEY',
        message: 'Missing required config',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Missing required config');
      expect(details.code).toBe('MISSING_REQUIRED');
      expect(details.context?.key).toBe('API_KEY');
    });

    it('should get details from SyncError', () => {
      const error = new SyncError({
        code: 'CONFLICT',
        operation: 'merge',
        message: 'Sync conflict',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Sync conflict');
      expect(details.code).toBe('CONFLICT');
      expect(details.context?.operation).toBe('merge');
    });

    it('should get details from ContentExtractionError', () => {
      const error = new ContentExtractionError({
        url: 'https://example.com',
        code: 'PARSE_FAILED',
        message: 'Failed to extract content',
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Failed to extract content');
      expect(details.code).toBe('PARSE_FAILED');
      expect(details.context?.url).toBe('https://example.com');
    });

    it('should get details from CriticalError', () => {
      const error = new CriticalError({
        message: 'Critical failure',
        context: { severity: 'high', timestamp: Date.now() },
      });

      const details = getErrorDetails(error);
      expect(details.message).toBe('Critical failure');
      expect(details.code).toBe('CRITICAL_ERROR');
      expect(details.context?.severity).toBe('high');
    });

    it('should handle standard Error instances', () => {
      const error = new Error('Standard error');
      const details = getErrorDetails(error);

      expect(details.message).toBe('Standard error');
      expect(details.code).toBe('UNKNOWN_ERROR');
      expect(details.context?.name).toBe('Error');
    });

    it('should handle unknown error types', () => {
      const error = { custom: 'error' };
      const details = getErrorDetails(error);

      expect(details.message).toBe('[object Object]');
      expect(details.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Effect Integration Patterns', () => {
    it('should compose error-returning effects', async () => {
      const fetchData = Effect.fail(
        new FetchError({
          url: 'https://api.example.com',
          code: 'NETWORK_ERROR',
          message: 'Network error',
        })
      );

      const processData = Effect.fail(
        new ProcessingError({
          bookmarkId: 'test-123',
          stage: 'parse',
          message: 'Processing error',
        })
      );

      const program = Effect.gen(function* () {
        const data = yield* fetchData.pipe(
          Effect.catchTag('FetchError', (error) =>
            Effect.succeed({ recovered: true, error })
          )
        );

        if ('recovered' in data) {
          return yield* Effect.succeed('Recovered from fetch error');
        }

        return yield* processData;
      });

      const result = await Effect.runPromise(program);
      expect(result).toBe('Recovered from fetch error');
    });

    it('should handle errors with tap and tapError', async () => {
      let errorLogged = false;

      const program = Effect.fail(
        new ValidationError({
          field: 'url',
          reason: 'invalid',
          message: 'Validation failed',
        })
      ).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            errorLogged = true;
          })
        ),
        Effect.catchAll(() => Effect.succeed('Handled'))
      );

      const result = await Effect.runPromise(program);
      expect(result).toBe('Handled');
      expect(errorLogged).toBe(true);
    });

    it('should transform errors with mapError', async () => {
      const program = Effect.fail(
        new FetchError({
          url: 'https://example.com',
          code: 'NETWORK_ERROR',
          message: 'Network error',
        })
      ).pipe(
        Effect.mapError(
          (error) =>
            new ProcessingError({
              bookmarkId: 'test-123',
              stage: 'fetch',
              message: 'Failed during fetch stage',
              originalError: error,
            })
        )
      );

      const result = await Effect.runPromiseExit(program);
      if (result._tag === 'Failure' && result.cause._tag === 'Fail') {
        const error = result.cause.error as ProcessingError;
        expect(error).toBeInstanceOf(ProcessingError);
        expect(error.originalError).toBeInstanceOf(FetchError);
      }
    });
  });
});
