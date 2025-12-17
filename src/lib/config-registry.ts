/**
 * Configuration Registry
 *
 * This module provides a registry of all configurable constants with metadata.
 * Similar to Firefox's about:config, it allows advanced users to modify
 * internal settings.
 */

import { db } from '../db/schema';

// Configuration value types
export type ConfigValueType = 'number' | 'string' | 'boolean';

// Configuration entry definition
export interface ConfigEntry {
  key: string;
  defaultValue: number | string | boolean;
  type: ConfigValueType;
  description: string;
  category: string;
  min?: number; // For number types
  max?: number; // For number types
}

// Categories for grouping config entries
export const CONFIG_CATEGORIES = {
  FETCHER: 'Fetcher',
  API: 'API',
  SEARCH: 'Search',
  QUEUE: 'Queue',
  PROCESSOR: 'Processor',
  WEBDAV: 'WebDAV',
  STUMBLE: 'Stumble',
  DATE: 'Date Formatting',
  HEALTH: 'Health Indicator',
  SIMILARITY: 'Similarity Thresholds',
} as const;

// Registry of all configurable constants
export const CONFIG_REGISTRY: ConfigEntry[] = [
  // Fetcher Configuration
  {
    key: 'FETCH_CONCURRENCY',
    defaultValue: 5,
    type: 'number',
    description: 'Number of URLs to fetch concurrently in bulk import operations',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1,
    max: 20,
  },
  {
    key: 'FETCH_TIMEOUT_MS',
    defaultValue: 30000,
    type: 'number',
    description: 'Timeout for fetching a single URL (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 5000,
    max: 120000,
  },
  {
    key: 'FETCH_MAX_HTML_SIZE',
    defaultValue: 10 * 1024 * 1024,
    type: 'number',
    description: 'Maximum HTML content size allowed (in bytes)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1024 * 1024,
    max: 50 * 1024 * 1024,
  },
  {
    key: 'FETCH_OFFSCREEN_BUFFER_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Additional timeout buffer for Chrome offscreen document message passing (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1000,
    max: 30000,
  },
  {
    key: 'PAGE_SETTLE_TIME_MS',
    defaultValue: 2000,
    type: 'number',
    description: 'Time to wait for DOM to stop changing before extracting HTML (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 500,
    max: 10000,
  },

  // API Configuration
  {
    key: 'DEFAULT_API_BASE_URL',
    defaultValue: 'https://api.openai.com/v1',
    type: 'string',
    description: 'Default API base URL for OpenAI-compatible endpoints',
    category: CONFIG_CATEGORIES.API,
  },
  {
    key: 'API_CONTENT_MAX_CHARS',
    defaultValue: 15000,
    type: 'number',
    description: 'Maximum characters to send to the chat API for Q&A generation',
    category: CONFIG_CATEGORIES.API,
    min: 1000,
    max: 100000,
  },
  {
    key: 'API_CHAT_TEMPERATURE',
    defaultValue: 0.7,
    type: 'number',
    description: 'Temperature setting for the chat model (controls randomness, 0-2)',
    category: CONFIG_CATEGORIES.API,
    min: 0,
    max: 2,
  },

  // Search Configuration
  {
    key: 'SEARCH_HISTORY_LIMIT',
    defaultValue: 50,
    type: 'number',
    description: 'Maximum number of search history entries to keep',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 10,
    max: 500,
  },
  {
    key: 'SEARCH_AUTOCOMPLETE_LIMIT',
    defaultValue: 10,
    type: 'number',
    description: 'Maximum number of autocomplete suggestions to display',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 3,
    max: 20,
  },
  {
    key: 'SEARCH_TOP_K_RESULTS',
    defaultValue: 200,
    type: 'number',
    description: 'Number of top results to retrieve from similarity search',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 10,
    max: 1000,
  },

  // Queue Configuration
  {
    key: 'QUEUE_PROCESSING_TIMEOUT_MS',
    defaultValue: 60 * 1000,
    type: 'number',
    description: 'Maximum time a bookmark can remain in processing state before being reset (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 30000,
    max: 300000,
  },
  {
    key: 'QUEUE_STATE_TIMEOUT_MS',
    defaultValue: 5 * 60 * 1000,
    type: 'number',
    description: 'Timeout for the queue processor state manager (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 60000,
    max: 600000,
  },
  {
    key: 'QUEUE_MAX_RETRIES',
    defaultValue: 3,
    type: 'number',
    description: 'Maximum number of retry attempts for failed bookmarks',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 1,
    max: 10,
  },
  {
    key: 'QUEUE_RETRY_BASE_DELAY_MS',
    defaultValue: 1000,
    type: 'number',
    description: 'Base delay for exponential backoff retry logic (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 500,
    max: 10000,
  },
  {
    key: 'QUEUE_RETRY_MAX_DELAY_MS',
    defaultValue: 8000,
    type: 'number',
    description: 'Maximum delay for exponential backoff retry logic (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 1000,
    max: 60000,
  },

  // Processor Configuration
  {
    key: 'PROCESSOR_QA_GENERATION_PROGRESS',
    defaultValue: 33,
    type: 'number',
    description: 'Progress percentage after Q&A generation completes',
    category: CONFIG_CATEGORIES.PROCESSOR,
    min: 10,
    max: 90,
  },
  {
    key: 'PROCESSOR_QA_SAVING_PROGRESS',
    defaultValue: 66,
    type: 'number',
    description: 'Progress percentage after embeddings are generated',
    category: CONFIG_CATEGORIES.PROCESSOR,
    min: 10,
    max: 90,
  },

  // WebDAV Configuration
  {
    key: 'WEBDAV_SYNC_TIMEOUT_MS',
    defaultValue: 2 * 60 * 1000,
    type: 'number',
    description: 'Timeout for the WebDAV sync state manager (in milliseconds)',
    category: CONFIG_CATEGORIES.WEBDAV,
    min: 30000,
    max: 600000,
  },
  {
    key: 'WEBDAV_SYNC_DEBOUNCE_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Minimum time between sync attempts (in milliseconds)',
    category: CONFIG_CATEGORIES.WEBDAV,
    min: 1000,
    max: 60000,
  },

  // Stumble Configuration
  {
    key: 'STUMBLE_COUNT',
    defaultValue: 10,
    type: 'number',
    description: 'Number of random bookmarks to display in stumble mode',
    category: CONFIG_CATEGORIES.STUMBLE,
    min: 1,
    max: 50,
  },

  // Date Formatting Configuration
  {
    key: 'DATE_RELATIVE_TIME_THRESHOLD_DAYS',
    defaultValue: 14,
    type: 'number',
    description: 'Number of days to show relative time (e.g., "2 days ago")',
    category: CONFIG_CATEGORIES.DATE,
    min: 1,
    max: 60,
  },
  {
    key: 'DATE_FULL_DATE_THRESHOLD_DAYS',
    defaultValue: 365,
    type: 'number',
    description: 'Number of days to show month/day format vs full date',
    category: CONFIG_CATEGORIES.DATE,
    min: 30,
    max: 730,
  },

  // Health Indicator Configuration
  {
    key: 'HEALTH_REFRESH_INTERVAL_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Auto-refresh interval for health status updates (in milliseconds)',
    category: CONFIG_CATEGORIES.HEALTH,
    min: 1000,
    max: 60000,
  },

  // Similarity Thresholds
  {
    key: 'SIMILARITY_THRESHOLD_EXCELLENT',
    defaultValue: 0.9,
    type: 'number',
    description: 'Similarity score threshold for "excellent" matches',
    category: CONFIG_CATEGORIES.SIMILARITY,
    min: 0,
    max: 1,
  },
  {
    key: 'SIMILARITY_THRESHOLD_GOOD',
    defaultValue: 0.7,
    type: 'number',
    description: 'Similarity score threshold for "good" matches',
    category: CONFIG_CATEGORIES.SIMILARITY,
    min: 0,
    max: 1,
  },
  {
    key: 'SIMILARITY_THRESHOLD_FAIR',
    defaultValue: 0.5,
    type: 'number',
    description: 'Similarity score threshold for "fair" matches',
    category: CONFIG_CATEGORIES.SIMILARITY,
    min: 0,
    max: 1,
  },
  {
    key: 'SIMILARITY_THRESHOLD_POOR',
    defaultValue: 0.3,
    type: 'number',
    description: 'Similarity score threshold for "poor" matches',
    category: CONFIG_CATEGORIES.SIMILARITY,
    min: 0,
    max: 1,
  },
];

// Storage key for config overrides
const CONFIG_STORAGE_KEY = 'advancedConfig';

// Cached overrides (loaded once at startup)
let configOverrides: Record<string, number | string | boolean> = {};
let overridesLoaded = false;

// Performance optimizations: O(1) lookups
// Registry map for fast entry lookup (avoids find() on every read)
const registryMap = new Map<string, ConfigEntry>(
  CONFIG_REGISTRY.map(entry => [entry.key, entry])
);

// Merged config cache (pre-computed defaults + overrides)
let configCache: Record<string, number | string | boolean> = {};

/**
 * Build the config cache by merging defaults with overrides
 * Called after loading overrides or when they change
 */
function rebuildConfigCache(): void {
  configCache = {};
  for (const entry of CONFIG_REGISTRY) {
    configCache[entry.key] = entry.key in configOverrides
      ? configOverrides[entry.key]
      : entry.defaultValue;
  }
}

// Initialize cache with default values
rebuildConfigCache();

/**
 * Load config overrides from IndexedDB
 */
export async function loadConfigOverrides(): Promise<void> {
  try {
    const stored = await db.settings.get(CONFIG_STORAGE_KEY);
    if (stored && stored.value) {
      configOverrides = stored.value;
    }
    overridesLoaded = true;
    rebuildConfigCache(); // Rebuild cache with loaded overrides
  } catch (error) {
    console.error('Failed to load config overrides:', error);
    configOverrides = {};
    overridesLoaded = true;
    rebuildConfigCache(); // Rebuild cache with empty overrides
  }
}

/**
 * Save config overrides to IndexedDB
 */
export async function saveConfigOverrides(): Promise<void> {
  try {
    const now = new Date();
    await db.settings.put({
      key: CONFIG_STORAGE_KEY,
      value: configOverrides,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    console.error('Failed to save config overrides:', error);
    throw error;
  }
}

/**
 * Get a config value (with override if set)
 * Uses pre-computed cache for O(1) lookups
 */
export function getConfigValue<T extends number | string | boolean>(key: string): T {
  // Verify key exists in registry using Map (O(1))
  if (!registryMap.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  // Return cached value (O(1) object property lookup)
  return configCache[key] as T;
}

/**
 * Set a config override
 */
export async function setConfigValue(key: string, value: number | string | boolean): Promise<void> {
  const entry = registryMap.get(key);
  if (!entry) {
    throw new Error(`Unknown config key: ${key}`);
  }

  // Validate type
  if (typeof value !== entry.type) {
    throw new Error(`Invalid type for ${key}: expected ${entry.type}, got ${typeof value}`);
  }

  // Validate range for numbers
  if (entry.type === 'number' && typeof value === 'number') {
    if (entry.min !== undefined && value < entry.min) {
      throw new Error(`Value for ${key} must be at least ${entry.min}`);
    }
    if (entry.max !== undefined && value > entry.max) {
      throw new Error(`Value for ${key} must be at most ${entry.max}`);
    }
  }

  configOverrides[key] = value;
  rebuildConfigCache(); // Update cache immediately
  await saveConfigOverrides();
}

/**
 * Reset a config value to default
 */
export async function resetConfigValue(key: string): Promise<void> {
  if (!registryMap.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  delete configOverrides[key];
  rebuildConfigCache(); // Update cache immediately
  await saveConfigOverrides();
}

/**
 * Reset all config values to defaults
 */
export async function resetAllConfigValues(): Promise<void> {
  configOverrides = {};
  rebuildConfigCache(); // Update cache immediately
  await saveConfigOverrides();
}

/**
 * Check if a config value has been modified from default
 */
export function isConfigModified(key: string): boolean {
  return key in configOverrides;
}

/**
 * Get all config entries with their current values
 */
export function getAllConfigEntries(): Array<ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }> {
  return CONFIG_REGISTRY.map(entry => ({
    ...entry,
    currentValue: getConfigValue(entry.key),
    isModified: isConfigModified(entry.key),
  }));
}

/**
 * Get config entries filtered by category
 */
export function getConfigEntriesByCategory(category: string): Array<ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }> {
  return getAllConfigEntries().filter(entry => entry.category === category);
}

/**
 * Search config entries by key or description
 */
export function searchConfigEntries(query: string): Array<ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }> {
  const lowerQuery = query.toLowerCase();
  return getAllConfigEntries().filter(entry =>
    entry.key.toLowerCase().includes(lowerQuery) ||
    entry.description.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get count of modified config entries
 */
export function getModifiedCount(): number {
  return Object.keys(configOverrides).length;
}

/**
 * Ensure overrides are loaded (call this before using getConfigValue)
 */
export async function ensureConfigLoaded(): Promise<void> {
  if (!overridesLoaded) {
    await loadConfigOverrides();
  }
}

// ============================================================================
// CONFIG OBJECT WITH GETTERS/SETTERS
// ============================================================================

/**
 * Type definition for the config object
 * Each property corresponds to a configurable constant
 */
export interface ConfigValues {
  // Fetcher
  FETCH_CONCURRENCY: number;
  FETCH_TIMEOUT_MS: number;
  FETCH_MAX_HTML_SIZE: number;
  FETCH_OFFSCREEN_BUFFER_MS: number;
  PAGE_SETTLE_TIME_MS: number;
  // API
  DEFAULT_API_BASE_URL: string;
  API_CONTENT_MAX_CHARS: number;
  API_CHAT_TEMPERATURE: number;
  // Search
  SEARCH_HISTORY_LIMIT: number;
  SEARCH_AUTOCOMPLETE_LIMIT: number;
  SEARCH_TOP_K_RESULTS: number;
  // Queue
  QUEUE_PROCESSING_TIMEOUT_MS: number;
  QUEUE_STATE_TIMEOUT_MS: number;
  QUEUE_MAX_RETRIES: number;
  QUEUE_RETRY_BASE_DELAY_MS: number;
  QUEUE_RETRY_MAX_DELAY_MS: number;
  // Processor
  PROCESSOR_QA_GENERATION_PROGRESS: number;
  PROCESSOR_QA_SAVING_PROGRESS: number;
  // WebDAV
  WEBDAV_SYNC_TIMEOUT_MS: number;
  WEBDAV_SYNC_DEBOUNCE_MS: number;
  // Stumble
  STUMBLE_COUNT: number;
  // Date
  DATE_RELATIVE_TIME_THRESHOLD_DAYS: number;
  DATE_FULL_DATE_THRESHOLD_DAYS: number;
  // Health
  HEALTH_REFRESH_INTERVAL_MS: number;
  // Similarity
  SIMILARITY_THRESHOLD_EXCELLENT: number;
  SIMILARITY_THRESHOLD_GOOD: number;
  SIMILARITY_THRESHOLD_FAIR: number;
  SIMILARITY_THRESHOLD_POOR: number;
}

/**
 * Default values for all config entries (used as fallback in tests)
 */
export const CONFIG_DEFAULTS: ConfigValues = CONFIG_REGISTRY.reduce((acc, entry) => {
  acc[entry.key as keyof ConfigValues] = entry.defaultValue as never;
  return acc;
}, {} as ConfigValues);

/**
 * Config object with getters that read from the config registry.
 * Use this instead of importing constants directly to respect user overrides.
 *
 * Example usage:
 *   import { config } from './config-registry';
 *   const timeout = config.FETCH_TIMEOUT_MS;
 *
 * For tests that need predictable values, use CONFIG_DEFAULTS instead.
 */
export const config: ConfigValues = Object.create(null);

// Create getters for each config entry
CONFIG_REGISTRY.forEach(entry => {
  Object.defineProperty(config, entry.key, {
    get(): number | string | boolean {
      return getConfigValue(entry.key);
    },
    enumerable: true,
    configurable: false,
  });
});
