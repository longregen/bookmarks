/**
 * Centralized configuration constants
 *
 * This file contains all magic numbers and configuration values used throughout the application.
 * Grouping constants by category makes them easier to maintain and modify.
 *
 * @deprecated These individual constant exports are kept for backward compatibility only.
 * New code should use the `config` object instead (e.g., `config.FETCH_CONCURRENCY`).
 * The config object automatically respects user overrides from the Advanced Config page.
 *
 * Example:
 *   import { config } from './constants';
 *   const timeout = config.FETCH_TIMEOUT_MS;
 */

import { config as configRegistry, CONFIG_DEFAULTS } from './config-registry';

// Re-export config object and defaults for convenience
export { configRegistry as config, CONFIG_DEFAULTS };

// ============================================================================
// FETCHER CONFIGURATION
// ============================================================================
// @deprecated Use config.FETCH_CONCURRENCY, config.FETCH_TIMEOUT_MS, etc. instead

/** @deprecated Use config.FETCH_CONCURRENCY instead */
export const FETCH_CONCURRENCY = 5;

/** @deprecated Use config.FETCH_TIMEOUT_MS instead */
export const FETCH_TIMEOUT_MS = 30000; // 30 seconds

/** @deprecated Use config.FETCH_MAX_HTML_SIZE instead */
export const FETCH_MAX_HTML_SIZE = 10 * 1024 * 1024; // 10 MB

/** @deprecated Use config.FETCH_OFFSCREEN_BUFFER_MS instead */
export const FETCH_OFFSCREEN_BUFFER_MS = 5000; // 5 seconds

// ============================================================================
// API CONFIGURATION
// ============================================================================
// @deprecated Use config.DEFAULT_API_BASE_URL, config.API_CONTENT_MAX_CHARS, etc. instead

/** @deprecated Use config.DEFAULT_API_BASE_URL instead */
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

/** @deprecated Use config.API_CONTENT_MAX_CHARS instead */
export const API_CONTENT_MAX_CHARS = 15000;

/** @deprecated Use config.API_CHAT_TEMPERATURE instead */
export const API_CHAT_TEMPERATURE = 0.7;

// ============================================================================
// SEARCH CONFIGURATION
// ============================================================================
// @deprecated Use config.SEARCH_HISTORY_LIMIT, config.SEARCH_AUTOCOMPLETE_LIMIT, etc. instead

/** @deprecated Use config.SEARCH_HISTORY_LIMIT instead */
export const SEARCH_HISTORY_LIMIT = 50;

/** @deprecated Use config.SEARCH_AUTOCOMPLETE_LIMIT instead */
export const SEARCH_AUTOCOMPLETE_LIMIT = 10;

/** @deprecated Use config.SEARCH_TOP_K_RESULTS instead */
export const SEARCH_TOP_K_RESULTS = 200;

// ============================================================================
// QUEUE CONFIGURATION
// ============================================================================
// @deprecated Use config.QUEUE_PROCESSING_TIMEOUT_MS, config.QUEUE_MAX_RETRIES, etc. instead

/**
 * @deprecated Use config.QUEUE_PROCESSING_TIMEOUT_MS instead
 * Maximum time a bookmark can remain in 'processing' state before being reset to 'pending'
 * (in milliseconds)
 */
export const QUEUE_PROCESSING_TIMEOUT_MS = 60 * 1000; // 1 minute

/** @deprecated Use config.QUEUE_STATE_TIMEOUT_MS instead */
export const QUEUE_STATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** @deprecated Use config.QUEUE_MAX_RETRIES instead */
export const QUEUE_MAX_RETRIES = 3;

/** @deprecated Use config.QUEUE_RETRY_BASE_DELAY_MS instead */
export const QUEUE_RETRY_BASE_DELAY_MS = 1000; // 1 second

/** @deprecated Use config.QUEUE_RETRY_MAX_DELAY_MS instead */
export const QUEUE_RETRY_MAX_DELAY_MS = 8000; // 8 seconds

// ============================================================================
// PROCESSOR CONFIGURATION
// ============================================================================
// @deprecated Use config.PROCESSOR_QA_GENERATION_PROGRESS, config.PROCESSOR_QA_SAVING_PROGRESS instead

/** @deprecated Use config.PROCESSOR_QA_GENERATION_PROGRESS instead */
export const PROCESSOR_QA_GENERATION_PROGRESS = 33;

/** @deprecated Use config.PROCESSOR_QA_SAVING_PROGRESS instead */
export const PROCESSOR_QA_SAVING_PROGRESS = 66;

// ============================================================================
// WEBDAV SYNC CONFIGURATION
// ============================================================================
// @deprecated Use config.WEBDAV_SYNC_TIMEOUT_MS, config.WEBDAV_SYNC_DEBOUNCE_MS instead

/** @deprecated Use config.WEBDAV_SYNC_TIMEOUT_MS instead */
export const WEBDAV_SYNC_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

/** @deprecated Use config.WEBDAV_SYNC_DEBOUNCE_MS instead */
export const WEBDAV_SYNC_DEBOUNCE_MS = 5000; // 5 seconds

// ============================================================================
// STUMBLE CONFIGURATION
// ============================================================================
// @deprecated Use config.STUMBLE_COUNT instead

/** @deprecated Use config.STUMBLE_COUNT instead */
export const STUMBLE_COUNT = 10;

// ============================================================================
// DATE FORMATTING CONFIGURATION
// ============================================================================
// @deprecated Use config.DATE_RELATIVE_TIME_THRESHOLD_DAYS, config.DATE_FULL_DATE_THRESHOLD_DAYS instead
// Note: TIME constants are NOT configurable and remain as-is

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

/** @deprecated Use config.DATE_RELATIVE_TIME_THRESHOLD_DAYS instead */
export const DATE_RELATIVE_TIME_THRESHOLD_DAYS = 14;

/** @deprecated Use config.DATE_FULL_DATE_THRESHOLD_DAYS instead */
export const DATE_FULL_DATE_THRESHOLD_DAYS = 365;

// ============================================================================
// HEALTH INDICATOR CONFIGURATION
// ============================================================================
// @deprecated Use config.HEALTH_REFRESH_INTERVAL_MS instead

/** @deprecated Use config.HEALTH_REFRESH_INTERVAL_MS instead */
export const HEALTH_REFRESH_INTERVAL_MS = 5000; // 5 seconds

// ============================================================================
// SIMILARITY SCORE THRESHOLDS (for debugging/analysis)
// ============================================================================
// @deprecated Use config.SIMILARITY_THRESHOLD_EXCELLENT, config.SIMILARITY_THRESHOLD_GOOD, etc. instead

/** @deprecated Use config object instead (config.SIMILARITY_THRESHOLD_EXCELLENT, etc.) */
export const SIMILARITY_THRESHOLD = {
  EXCELLENT: 0.9,
  GOOD: 0.7,
  FAIR: 0.5,
  POOR: 0.3,
} as const;

// Backward compatibility exports
/** @deprecated Use config.SIMILARITY_THRESHOLD_EXCELLENT instead */
export const SIMILARITY_THRESHOLD_EXCELLENT = SIMILARITY_THRESHOLD.EXCELLENT;

/** @deprecated Use config.SIMILARITY_THRESHOLD_GOOD instead */
export const SIMILARITY_THRESHOLD_GOOD = SIMILARITY_THRESHOLD.GOOD;

/** @deprecated Use config.SIMILARITY_THRESHOLD_FAIR instead */
export const SIMILARITY_THRESHOLD_FAIR = SIMILARITY_THRESHOLD.FAIR;

/** @deprecated Use config.SIMILARITY_THRESHOLD_POOR instead */
export const SIMILARITY_THRESHOLD_POOR = SIMILARITY_THRESHOLD.POOR;
