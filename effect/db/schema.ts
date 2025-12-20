import * as Data from 'effect/Data';

// ============================================================================
// Data Models
// ============================================================================

/**
 * Core bookmark entity representing a saved webpage
 */
export interface Bookmark {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly html: string;
  readonly status: BookmarkStatus;
  readonly errorMessage?: string;
  readonly retryCount?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Bookmark processing status lifecycle
 */
export type BookmarkStatus =
  | 'fetching'    // Initial state: downloading HTML
  | 'downloaded'  // HTML downloaded, pending processing
  | 'pending'     // Queued for markdown extraction
  | 'processing'  // Extracting markdown and generating Q&A pairs
  | 'complete'    // Fully processed with embeddings
  | 'error';      // Processing failed

/**
 * Extracted markdown content from a bookmark
 */
export interface Markdown {
  readonly id: string;
  readonly bookmarkId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Question-answer pair with embeddings for semantic search
 */
export interface QuestionAnswer {
  readonly id: string;
  readonly bookmarkId: string;
  readonly question: string;
  readonly answer: string;
  readonly embeddingQuestion: readonly number[];
  readonly embeddingAnswer: readonly number[];
  readonly embeddingBoth: readonly number[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Application settings stored as key-value pairs
 */
export interface Settings {
  readonly key: string;
  readonly value: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Tag associated with a bookmark for categorization
 */
export interface BookmarkTag {
  readonly bookmarkId: string;
  readonly tagName: string;
  readonly addedAt: Date;
}

/**
 * Search query history for analytics and suggestions
 */
export interface SearchHistory {
  readonly id: string;
  readonly query: string;
  readonly resultCount: number;
  readonly createdAt: Date;
}

// ============================================================================
// Job System Types
// ============================================================================

/**
 * Types of background jobs
 */
export type JobType =
  | 'file_import'        // Import bookmarks from file (HTML, JSON)
  | 'bulk_url_import'    // Import multiple URLs
  | 'url_fetch';         // Fetch single URL

/**
 * Job execution status
 */
export type JobStatus =
  | 'pending'       // Queued, not started
  | 'in_progress'   // Currently executing
  | 'completed'     // Successfully finished
  | 'failed'        // Failed with error
  | 'cancelled';    // Manually cancelled

/**
 * Individual job item status (sub-task within a job)
 */
export type JobItemStatus =
  | 'pending'       // Not started
  | 'in_progress'   // Currently processing
  | 'complete'      // Successfully completed
  | 'error';        // Failed with error

/**
 * Metadata for job execution, varies by job type
 */
export interface JobMetadata {
  // FILE_IMPORT specific
  readonly fileName?: string;
  readonly importedCount?: number;
  readonly skippedCount?: number;

  // BULK_URL_IMPORT specific
  readonly totalUrls?: number;
  readonly successCount?: number;
  readonly failureCount?: number;

  // URL_FETCH specific
  readonly url?: string;
  readonly bookmarkId?: string;

  // Error info (all types)
  readonly errorMessage?: string;
}

/**
 * Background job for async processing
 */
export interface Job {
  readonly id: string;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly parentJobId?: string;
  readonly metadata: JobMetadata;
  readonly createdAt: Date;
}

/**
 * Individual item within a job (e.g., one URL in a bulk import)
 */
export interface JobItem {
  readonly id: string;
  readonly jobId: string;
  readonly bookmarkId: string;
  readonly status: JobItemStatus;
  readonly retryCount: number;
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ============================================================================
// Composite Types
// ============================================================================

/**
 * Complete bookmark content including markdown, Q&A pairs, and tags
 */
export interface BookmarkContent {
  readonly markdown?: Markdown;
  readonly qaPairs: readonly QuestionAnswer[];
  readonly tags: readonly BookmarkTag[];
}

/**
 * Bookmark with all associated content loaded
 */
export interface BookmarkWithContent extends Bookmark {
  readonly content: BookmarkContent;
}

// ============================================================================
// Schema Validation Types
// ============================================================================

/**
 * Field validation result
 */
export interface FieldValidation {
  readonly field: string;
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Complete entity validation result
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly FieldValidation[];
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Filter operators for queries
 */
export type QueryOperator =
  | 'eq'         // Equals
  | 'contains'   // String contains
  | 'in'         // Value in array
  | 'gte'        // Greater than or equal
  | 'lte'        // Less than or equal
  | 'range';     // Between two values

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort specification
 */
export interface SortSpec {
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * Query filter specification
 */
export interface QueryFilter {
  readonly field?: string;
  readonly operator?: QueryOperator;
  readonly value?: unknown;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: readonly SortSpec[];
}

// ============================================================================
// Table Names (Type-Safe)
// ============================================================================

/**
 * Database table names as a discriminated union for type safety
 */
export type TableName =
  | 'bookmarks'
  | 'markdown'
  | 'questionsAnswers'
  | 'settings'
  | 'jobs'
  | 'jobItems'
  | 'bookmarkTags'
  | 'searchHistory';

/**
 * Map table names to their entity types
 */
export interface TableEntityMap {
  readonly bookmarks: Bookmark;
  readonly markdown: Markdown;
  readonly questionsAnswers: QuestionAnswer;
  readonly settings: Settings;
  readonly jobs: Job;
  readonly jobItems: JobItem;
  readonly bookmarkTags: BookmarkTag;
  readonly searchHistory: SearchHistory;
}

// ============================================================================
// Database Schema Errors
// ============================================================================

/**
 * Schema validation error - thrown when data doesn't match expected schema
 */
export class SchemaValidationError extends Data.TaggedError('SchemaValidationError')<{
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
  readonly expected?: string;
}> {}

/**
 * Database schema error - thrown during migrations or schema operations
 */
export class DatabaseSchemaError extends Data.TaggedError('DatabaseSchemaError')<{
  readonly operation: 'migration' | 'validation' | 'initialization' | 'upgrade';
  readonly version?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Constraint violation error - thrown when database constraints are violated
 */
export class ConstraintViolationError extends Data.TaggedError('ConstraintViolationError')<{
  readonly table: TableName;
  readonly constraint: 'primary_key' | 'foreign_key' | 'unique' | 'not_null';
  readonly field?: string;
  readonly message: string;
  readonly value?: unknown;
}> {}

/**
 * Entity not found error - thrown when querying for non-existent entity
 */
export class EntityNotFoundError extends Data.TaggedError('EntityNotFoundError')<{
  readonly table: TableName;
  readonly id: string;
  readonly message?: string;
}> {}

// ============================================================================
// Schema Version
// ============================================================================

/**
 * Current database schema version
 * Increment when making schema changes that require migrations
 */
export const SCHEMA_VERSION = 5 as const;

/**
 * Database name constant
 */
export const DATABASE_NAME = 'BookmarkRAG' as const;

// ============================================================================
// Index Specifications
// ============================================================================

/**
 * Index configuration for a table
 */
export interface IndexSpec {
  readonly fields: readonly string[];
  readonly unique?: boolean;
  readonly multiEntry?: boolean;
}

/**
 * Complete table schema including indexes
 */
export interface TableSchema {
  readonly name: TableName;
  readonly primaryKey: string;
  readonly indexes: readonly IndexSpec[];
}

/**
 * Schema definition for all tables
 * Used by storage adapters to create/validate table structures
 */
export const SCHEMA: readonly TableSchema[] = [
  {
    name: 'bookmarks',
    primaryKey: 'id',
    indexes: [
      { fields: ['url'], unique: true },
      { fields: ['status'] },
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
    ],
  },
  {
    name: 'markdown',
    primaryKey: 'id',
    indexes: [
      { fields: ['bookmarkId'], unique: true },
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
    ],
  },
  {
    name: 'questionsAnswers',
    primaryKey: 'id',
    indexes: [
      { fields: ['bookmarkId'] },
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
    ],
  },
  {
    name: 'settings',
    primaryKey: 'key',
    indexes: [
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
    ],
  },
  {
    name: 'jobs',
    primaryKey: 'id',
    indexes: [
      { fields: ['parentJobId'] },
      { fields: ['status'] },
      { fields: ['type'] },
      { fields: ['createdAt'] },
      { fields: ['parentJobId', 'status'] },
    ],
  },
  {
    name: 'jobItems',
    primaryKey: 'id',
    indexes: [
      { fields: ['jobId'] },
      { fields: ['bookmarkId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
      { fields: ['jobId', 'status'] },
    ],
  },
  {
    name: 'bookmarkTags',
    primaryKey: ['bookmarkId', 'tagName'],
    indexes: [
      { fields: ['bookmarkId'] },
      { fields: ['tagName'] },
      { fields: ['addedAt'] },
    ],
  },
  {
    name: 'searchHistory',
    primaryKey: 'id',
    indexes: [
      { fields: ['query'] },
      { fields: ['createdAt'] },
    ],
  },
] as const;
