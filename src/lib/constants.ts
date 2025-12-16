/**
 * Centralized configuration constants
 *
 * This file contains all magic numbers and configuration values used throughout the application.
 * Grouping constants by category makes them easier to maintain and modify.
 */

// ============================================================================
// FETCHER CONFIGURATION
// ============================================================================

/** Number of URLs to fetch concurrently in bulk import operations */
export const FETCH_CONCURRENCY = 5;

/** Timeout for fetching a single URL (in milliseconds) */
export const FETCH_TIMEOUT_MS = 30000; // 30 seconds

/** Maximum HTML content size allowed (in bytes) */
export const FETCH_MAX_HTML_SIZE = 10 * 1024 * 1024; // 10 MB

/** Additional timeout buffer for Chrome offscreen document message passing (in milliseconds) */
export const FETCH_OFFSCREEN_BUFFER_MS = 5000; // 5 seconds

// ============================================================================
// API CONFIGURATION
// ============================================================================

/** Default API base URL for OpenAI-compatible endpoints */
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

/** Maximum characters to send to the chat API for Q&A generation */
export const API_CONTENT_MAX_CHARS = 15000;

/** Temperature setting for the chat model (controls randomness) */
export const API_CHAT_TEMPERATURE = 0.7;

// ============================================================================
// SEARCH CONFIGURATION
// ============================================================================

/** Maximum number of search history entries to keep */
export const SEARCH_HISTORY_LIMIT = 50;

/** Maximum number of autocomplete suggestions to display */
export const SEARCH_AUTOCOMPLETE_LIMIT = 10;

/** Number of top results to retrieve from similarity search */
export const SEARCH_TOP_K_RESULTS = 200;

// ============================================================================
// QUEUE CONFIGURATION
// ============================================================================

/**
 * Maximum time a bookmark can remain in 'processing' state before being reset to 'pending'
 * (in milliseconds)
 */
export const QUEUE_PROCESSING_TIMEOUT_MS = 60 * 1000; // 1 minute

/** Timeout for the queue processor state manager (in milliseconds) */
export const QUEUE_STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum number of retry attempts for failed bookmarks */
export const QUEUE_MAX_RETRIES = 3;

/** Base delay for exponential backoff retry logic (in milliseconds) */
export const QUEUE_RETRY_BASE_DELAY_MS = 1000; // 1 second

/** Maximum delay for exponential backoff retry logic (in milliseconds) */
export const QUEUE_RETRY_MAX_DELAY_MS = 8000; // 8 seconds

// ============================================================================
// PROCESSOR CONFIGURATION
// ============================================================================

/** Progress percentage after Q&A generation completes */
export const PROCESSOR_QA_GENERATION_PROGRESS = 33;

/** Progress percentage after embeddings are generated */
export const PROCESSOR_QA_SAVING_PROGRESS = 66;

// ============================================================================
// WEBDAV SYNC CONFIGURATION
// ============================================================================

/** Timeout for the WebDAV sync state manager (in milliseconds) */
export const WEBDAV_SYNC_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** Minimum time between sync attempts (in milliseconds) */
export const WEBDAV_SYNC_DEBOUNCE_MS = 5000; // 5 seconds

// ============================================================================
// STUMBLE CONFIGURATION
// ============================================================================

/** Number of random bookmarks to display in stumble mode */
export const STUMBLE_COUNT = 10;

// ============================================================================
// DATE FORMATTING CONFIGURATION
// ============================================================================

/** Time-related constants grouped for better organization */
export const TIME = {
  SECONDS_PER_MINUTE: 60,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  MS_PER_DAY: 86400000,
} as const;

// Backward compatibility exports
/** Seconds in a minute */
export const TIME_SECONDS_PER_MINUTE = TIME.SECONDS_PER_MINUTE;

/** Minutes in an hour */
export const TIME_MINUTES_PER_HOUR = TIME.MINUTES_PER_HOUR;

/** Hours in a day */
export const TIME_HOURS_PER_DAY = TIME.HOURS_PER_DAY;

/** Milliseconds in a day */
export const TIME_MS_PER_DAY = TIME.MS_PER_DAY;

/** Number of days to show relative time (e.g., "2 days ago") */
export const DATE_RELATIVE_TIME_THRESHOLD_DAYS = 14;

/** Number of days to show month/day format vs full date */
export const DATE_FULL_DATE_THRESHOLD_DAYS = 365;

// ============================================================================
// HEALTH INDICATOR CONFIGURATION
// ============================================================================

/** Auto-refresh interval for health status updates (in milliseconds) */
export const HEALTH_REFRESH_INTERVAL_MS = 5000; // 5 seconds

// ============================================================================
// SIMILARITY SCORE THRESHOLDS (for debugging/analysis)
// ============================================================================

/** Similarity score thresholds grouped for better organization */
export const SIMILARITY_THRESHOLD = {
  EXCELLENT: 0.9,
  GOOD: 0.7,
  FAIR: 0.5,
  POOR: 0.3,
} as const;

// Backward compatibility exports
/** Similarity score threshold for "excellent" matches */
export const SIMILARITY_THRESHOLD_EXCELLENT = SIMILARITY_THRESHOLD.EXCELLENT;

/** Similarity score threshold for "good" matches */
export const SIMILARITY_THRESHOLD_GOOD = SIMILARITY_THRESHOLD.GOOD;

/** Similarity score threshold for "fair" matches */
export const SIMILARITY_THRESHOLD_FAIR = SIMILARITY_THRESHOLD.FAIR;

/** Similarity score threshold for "poor" matches */
export const SIMILARITY_THRESHOLD_POOR = SIMILARITY_THRESHOLD.POOR;
