/**
 * Centralized constants for the application
 * All magic numbers should be defined here with clear documentation
 */

// ============================================================================
// Fetcher Settings
// ============================================================================

/**
 * Number of URLs to fetch concurrently during bulk import operations.
 * Higher values increase throughput but may overwhelm the network or API.
 */
export const FETCH_CONCURRENCY = 5;

/**
 * Timeout for fetching individual URLs during bulk import (in milliseconds).
 * If a URL takes longer than this to load, the fetch will be aborted.
 */
export const FETCH_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Maximum allowed HTML content size (in bytes).
 * Content larger than this will be rejected to prevent memory issues.
 */
export const MAX_HTML_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Additional timeout buffer for offscreen document message passing (in milliseconds).
 * Added to the base timeout to account for IPC overhead in Chrome.
 */
export const OFFSCREEN_MESSAGE_BUFFER_MS = 5000; // 5 seconds

// ============================================================================
// API Settings
// ============================================================================

/**
 * Maximum length of markdown content sent to the LLM for Q&A generation (in characters).
 * Content longer than this will be truncated to avoid exceeding context window limits.
 */
export const MAX_CONTENT_LENGTH = 15000;

/**
 * Temperature parameter for LLM Q&A generation.
 * Controls randomness: 0.0 = deterministic, 1.0 = very random.
 */
export const LLM_TEMPERATURE = 0.7;

// ============================================================================
// Search Settings
// ============================================================================

/**
 * Maximum number of search queries to keep in search history.
 * Older queries beyond this limit are automatically deleted.
 */
export const MAX_SEARCH_HISTORY = 50;

/**
 * Number of top-K results to retrieve from similarity search.
 * This is the initial pool before filtering by tags/status.
 */
export const SEARCH_TOP_K = 200;

/**
 * Maximum number of autocomplete suggestions to display.
 */
export const MAX_AUTOCOMPLETE_SUGGESTIONS = 10;

// ============================================================================
// Export/Import Settings
// ============================================================================

/**
 * Export format version for bookmark exports.
 * Increment this when making breaking changes to the export format.
 * v1: Original format with raw number[] embeddings
 * v2: Embeddings encoded as base64 strings (16-bit quantized)
 */
export const EXPORT_VERSION = 2;

/**
 * Maximum length for sanitized filenames (in characters).
 * Longer names will be truncated to this length.
 */
export const MAX_FILENAME_LENGTH = 50;

/**
 * Maximum number of error messages to include in export metadata.
 * This prevents the export file from becoming too large with error details.
 */
export const MAX_EXPORT_ERRORS = 10;

// ============================================================================
// WebDAV Sync Settings
// ============================================================================

/**
 * Minimum time between sync attempts (in milliseconds).
 * Prevents excessive sync requests that could overwhelm the server.
 */
export const SYNC_DEBOUNCE_MS = 5000; // 5 seconds

// ============================================================================
// Queue Processing Settings
// ============================================================================

/**
 * Timeout for bookmarks stuck in 'processing' state (in milliseconds).
 * Bookmarks processing longer than this will be reset to 'pending'.
 */
export const PROCESSING_TIMEOUT_MS = 60 * 1000; // 1 minute

/**
 * Timeout for processing lock (in milliseconds).
 * If the processing lock is held longer than this, it's considered stale.
 */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Content Extraction Settings
// ============================================================================

/**
 * Timeout for content extraction from HTML (in milliseconds).
 * If extraction takes longer than this, it will be aborted.
 */
export const EXTRACTION_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Length of HTML preview in processor logs (in characters).
 * Used for debugging without cluttering logs with full content.
 */
export const HTML_PREVIEW_LENGTH = 200;

/**
 * Length of markdown/content preview in processor logs (in characters).
 * Used for debugging without cluttering logs with full content.
 */
export const CONTENT_PREVIEW_LENGTH = 200;

/**
 * Length of sample question/answer preview in processor logs (in characters).
 * Used for debugging embedding generation without cluttering logs.
 */
export const SAMPLE_QA_PREVIEW_LENGTH = 100;

// ============================================================================
// Job Progress Settings
// ============================================================================

/**
 * Progress percentage when Q&A generation starts generating embeddings.
 */
export const QA_EMBEDDINGS_PROGRESS = 33;

/**
 * Progress percentage when Q&A generation starts saving pairs to database.
 */
export const QA_SAVING_PROGRESS = 66;

/**
 * Progress percentage for completed jobs.
 */
export const JOB_COMPLETE_PROGRESS = 100;

/**
 * Default maximum number of jobs to return from getRecentJobs query.
 */
export const DEFAULT_JOBS_LIMIT = 100;

/**
 * Default number of days to keep completed jobs before cleanup.
 */
export const DEFAULT_JOB_RETENTION_DAYS = 30;
