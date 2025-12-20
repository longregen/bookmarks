import { Data } from 'effect';

export class StorageError extends Data.TaggedError('StorageError')<{
  readonly code:
    | 'NOT_FOUND'
    | 'CONSTRAINT_VIOLATION'
    | 'QUOTA_EXCEEDED'
    | 'TRANSACTION_FAILED'
    | 'UNKNOWN';
  readonly operation: 'read' | 'write' | 'delete' | 'query' | 'transaction';
  readonly table: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class RepositoryError extends Data.TaggedError('RepositoryError')<{
  readonly code:
    | 'NOT_FOUND'
    | 'VALIDATION_FAILED'
    | 'CONSTRAINT_VIOLATION'
    | 'QUOTA_EXCEEDED'
    | 'CONCURRENT_MODIFICATION'
    | 'UNKNOWN';
  readonly entity: string;
  readonly operation: 'get' | 'create' | 'update' | 'delete' | 'query';
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class FetchError extends Data.TaggedError('FetchError')<{
  readonly url: string;
  readonly code:
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'INVALID_RESPONSE'
    | 'RATE_LIMITED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'UNKNOWN';
  readonly message: string;
  readonly status?: number;
  readonly originalError?: unknown;
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly field: string;
  readonly reason: string;
  readonly value?: unknown;
  readonly message: string;
}> {}

export class JobQueueError extends Data.TaggedError('JobQueueError')<{
  readonly jobId: string;
  readonly code:
    | 'MAX_RETRIES_EXCEEDED'
    | 'CANCELLED'
    | 'VALIDATION_FAILED'
    | 'PROCESSING_FAILED'
    | 'TIMEOUT'
    | 'UNKNOWN';
  readonly message: string;
  readonly retryCount?: number;
  readonly originalError?: unknown;
}> {}

export class ProcessingError extends Data.TaggedError('ProcessingError')<{
  readonly bookmarkId: string;
  readonly stage: 'fetch' | 'parse' | 'embed' | 'save';
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class EmbeddingError extends Data.TaggedError('EmbeddingError')<{
  readonly code:
    | 'API_ERROR'
    | 'RATE_LIMITED'
    | 'INVALID_INPUT'
    | 'QUOTA_EXCEEDED'
    | 'MODEL_NOT_AVAILABLE'
    | 'UNKNOWN';
  readonly provider: 'openai' | 'anthropic' | 'local';
  readonly message: string;
  readonly retryAfter?: number;
  readonly originalError?: unknown;
}> {}

export class SearchError extends Data.TaggedError('SearchError')<{
  readonly code:
    | 'QUERY_INVALID'
    | 'INDEX_UNAVAILABLE'
    | 'EMBEDDING_FAILED'
    | 'TIMEOUT'
    | 'UNKNOWN';
  readonly query: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly code: 'INVALID_CONFIG' | 'MISSING_REQUIRED' | 'PARSE_ERROR' | 'UNKNOWN';
  readonly key: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class SyncError extends Data.TaggedError('SyncError')<{
  readonly code:
    | 'AUTHENTICATION_FAILED'
    | 'NETWORK_ERROR'
    | 'CONFLICT'
    | 'QUOTA_EXCEEDED'
    | 'INVALID_STATE'
    | 'UNKNOWN';
  readonly operation: 'pull' | 'push' | 'merge' | 'authenticate';
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class ContentExtractionError extends Data.TaggedError(
  'ContentExtractionError'
)<{
  readonly url: string;
  readonly code: 'PARSE_FAILED' | 'INVALID_HTML' | 'UNSUPPORTED_CONTENT' | 'UNKNOWN';
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class MarkdownError extends Data.TaggedError('MarkdownError')<{
  readonly bookmarkId: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class QAGenerationError extends Data.TaggedError('QAGenerationError')<{
  readonly bookmarkId: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class CriticalError extends Data.TaggedError('CriticalError')<{
  readonly message: string;
  readonly originalError?: unknown;
  readonly context?: Record<string, unknown>;
}> {}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
}

export function getErrorDetails(error: unknown): {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
} {
  if (error instanceof StorageError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        operation: error.operation,
        table: error.table,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof RepositoryError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        entity: error.entity,
        operation: error.operation,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof NetworkError) {
    return {
      message: error.message,
      code: 'NETWORK_ERROR',
      context: {
        url: error.url,
        status: error.status,
        statusText: error.statusText,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof FetchError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        url: error.url,
        status: error.status,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof ValidationError) {
    return {
      message: error.message,
      code: 'VALIDATION_ERROR',
      context: {
        field: error.field,
        reason: error.reason,
        value: error.value,
      },
    };
  }

  if (error instanceof JobQueueError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        jobId: error.jobId,
        retryCount: error.retryCount,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof ProcessingError) {
    return {
      message: error.message,
      code: 'PROCESSING_ERROR',
      context: {
        bookmarkId: error.bookmarkId,
        stage: error.stage,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof EmbeddingError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        provider: error.provider,
        retryAfter: error.retryAfter,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof SearchError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        query: error.query,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof ConfigError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        key: error.key,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof SyncError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        operation: error.operation,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof ContentExtractionError) {
    return {
      message: error.message,
      code: error.code,
      context: {
        url: error.url,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof MarkdownError) {
    return {
      message: error.message,
      code: 'MARKDOWN_ERROR',
      context: {
        bookmarkId: error.bookmarkId,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof QAGenerationError) {
    return {
      message: error.message,
      code: 'QA_GENERATION_ERROR',
      context: {
        bookmarkId: error.bookmarkId,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof CriticalError) {
    return {
      message: error.message,
      code: 'CRITICAL_ERROR',
      context: {
        ...error.context,
        originalError: error.originalError,
      },
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: 'UNKNOWN_ERROR',
      context: {
        name: error.name,
        stack: error.stack,
      },
    };
  }

  return {
    message: getErrorMessage(error),
    code: 'UNKNOWN_ERROR',
  };
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof FetchError) {
    return (
      error.code === 'NETWORK_ERROR' ||
      error.code === 'TIMEOUT' ||
      error.code === 'RATE_LIMITED'
    );
  }

  if (error instanceof EmbeddingError) {
    return error.code === 'RATE_LIMITED' || error.code === 'API_ERROR';
  }

  if (error instanceof SyncError) {
    return error.code === 'NETWORK_ERROR' || error.code === 'CONFLICT';
  }

  if (error instanceof NetworkError) {
    return error.status !== 404 && error.status !== 403;
  }

  if (error instanceof StorageError) {
    return false;
  }

  if (error instanceof ValidationError) {
    return false;
  }

  return false;
}

export function shouldEscalateError(error: unknown): boolean {
  if (error instanceof CriticalError) {
    return true;
  }

  if (error instanceof StorageError) {
    return (
      error.code === 'QUOTA_EXCEEDED' || error.code === 'TRANSACTION_FAILED'
    );
  }

  if (error instanceof RepositoryError) {
    return error.code === 'QUOTA_EXCEEDED';
  }

  if (error instanceof EmbeddingError) {
    return error.code === 'QUOTA_EXCEEDED';
  }

  if (error instanceof SyncError) {
    return error.code === 'AUTHENTICATION_FAILED';
  }

  return false;
}
