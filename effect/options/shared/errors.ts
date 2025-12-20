import * as Data from 'effect/Data';

/**
 * Shared error type for DOM-related operations
 */
export class DOMError extends Data.TaggedError('DOMError')<{
  readonly elementId?: string;
  readonly selector?: string;
  readonly operation: 'get' | 'render' | 'event' | 'query' | 'update';
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Shared error type for UI element not found
 */
export class UIElementNotFoundError extends Data.TaggedError('UIElementNotFoundError')<{
  readonly elementId: string;
  readonly message: string;
}> {}

/**
 * Shared error type for service operations
 */
export class ServiceError extends Data.TaggedError('ServiceError')<{
  readonly service: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
