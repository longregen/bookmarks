import { db } from '../db/schema';

export type ConfigValueType = 'number' | 'string' | 'boolean' | 'textarea';

export interface ConfigEntry {
  key: string;
  defaultValue: number | string | boolean;
  type: ConfigValueType;
  description: string;
  category: string;
  min?: number;
  max?: number;
}

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

export const CONFIG_REGISTRY: ConfigEntry[] = [
  {
    key: 'FETCH_CONCURRENCY',
    defaultValue: 5,
    type: 'number',
    description: 'Number of URLs to fetch concurrently in bulk import operations',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1,
    max: 50,
  },
  {
    key: 'FETCH_TIMEOUT_MS',
    defaultValue: 30000,
    type: 'number',
    description: 'Timeout for fetching a single URL (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 5000,
    max: 300000,
  },
  {
    key: 'FETCH_MAX_HTML_SIZE',
    defaultValue: 10 * 1024 * 1024,
    type: 'number',
    description: 'Maximum HTML content size allowed (in bytes)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1024 * 1024,
    max: 100 * 1024 * 1024,
  },
  {
    key: 'FETCH_OFFSCREEN_BUFFER_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Additional timeout buffer for Chrome offscreen document message passing (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1000,
    max: 60000,
  },
  {
    key: 'PAGE_SETTLE_TIME_MS',
    defaultValue: 2000,
    type: 'number',
    description: 'Time to wait for DOM to stop changing before extracting HTML (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 500,
    max: 30000,
  },
  {
    key: 'PAGE_SETTLE_MAX_MULTIPLIER',
    defaultValue: 3,
    type: 'number',
    description: 'Maximum wait time multiplier for DOM extraction (prevents hanging on busy pages)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 1,
    max: 10,
  },
  {
    key: 'TAB_CREATION_DELAY_MS',
    defaultValue: 500,
    type: 'number',
    description: 'Delay between creating tabs during bulk import to prevent overloading the browser (in milliseconds)',
    category: CONFIG_CATEGORIES.FETCHER,
    min: 0,
    max: 5000,
  },
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
    max: 500000,
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
  {
    key: 'API_CHAT_USE_TEMPERATURE',
    defaultValue: true,
    type: 'boolean',
    description: 'Include temperature parameter in chat API requests (disable for APIs that reject it)',
    category: CONFIG_CATEGORIES.API,
  },
  {
    key: 'QA_SYSTEM_PROMPT',
    defaultValue: `You are a helpful assistant that generates question-answer pairs for semantic search retrieval.

Given a document, generate 5-10 diverse Q&A pairs that:
1. Cover the main topics and key facts in the document
2. Include both factual questions ("What is X?") and conceptual questions ("How does X work?")
3. Would help someone find this document when searching with related queries
4. Have concise but complete answers (1-3 sentences each)

Respond with JSON only, no other text. Format:
{"pairs": [{"question": "...", "answer": "..."}, ...]}`,
    type: 'textarea',
    description: 'System prompt for Q&A generation. Controls how the AI generates question-answer pairs.',
    category: CONFIG_CATEGORIES.API,
  },
  {
    key: 'SEARCH_HISTORY_LIMIT',
    defaultValue: 50,
    type: 'number',
    description: 'Maximum number of search history entries to keep',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 10,
    max: 2000,
  },
  {
    key: 'SEARCH_AUTOCOMPLETE_LIMIT',
    defaultValue: 10,
    type: 'number',
    description: 'Maximum number of autocomplete suggestions to display',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 3,
    max: 50,
  },
  {
    key: 'SEARCH_TOP_K_RESULTS',
    defaultValue: 200,
    type: 'number',
    description: 'Number of top results to retrieve from similarity search',
    category: CONFIG_CATEGORIES.SEARCH,
    min: 10,
    max: 5000,
  },
  {
    key: 'QUEUE_PROCESSING_TIMEOUT_MS',
    defaultValue: 60 * 1000,
    type: 'number',
    description: 'Maximum time a bookmark can remain in processing state before being reset (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 30000,
    max: 600000,
  },
  {
    key: 'QUEUE_STATE_TIMEOUT_MS',
    defaultValue: 5 * 60 * 1000,
    type: 'number',
    description: 'Timeout for the queue processor state manager (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 60000,
    max: 1800000,
  },
  {
    key: 'QUEUE_MAX_RETRIES',
    defaultValue: 3,
    type: 'number',
    description: 'Maximum number of retry attempts for failed bookmarks',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 1,
    max: 20,
  },
  {
    key: 'QUEUE_RETRY_BASE_DELAY_MS',
    defaultValue: 1000,
    type: 'number',
    description: 'Base delay for exponential backoff retry logic (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 500,
    max: 30000,
  },
  {
    key: 'QUEUE_RETRY_MAX_DELAY_MS',
    defaultValue: 8000,
    type: 'number',
    description: 'Maximum delay for exponential backoff retry logic (in milliseconds)',
    category: CONFIG_CATEGORIES.QUEUE,
    min: 1000,
    max: 300000,
  },
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
  {
    key: 'WEBDAV_SYNC_TIMEOUT_MS',
    defaultValue: 2 * 60 * 1000,
    type: 'number',
    description: 'Timeout for the WebDAV sync state manager (in milliseconds)',
    category: CONFIG_CATEGORIES.WEBDAV,
    min: 30000,
    max: 1800000,
  },
  {
    key: 'WEBDAV_SYNC_DEBOUNCE_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Minimum time between sync attempts (in milliseconds)',
    category: CONFIG_CATEGORIES.WEBDAV,
    min: 1000,
    max: 300000,
  },
  {
    key: 'STUMBLE_COUNT',
    defaultValue: 10,
    type: 'number',
    description: 'Number of random bookmarks to display in stumble mode',
    category: CONFIG_CATEGORIES.STUMBLE,
    min: 1,
    max: 100,
  },
  {
    key: 'DATE_RELATIVE_TIME_THRESHOLD_DAYS',
    defaultValue: 14,
    type: 'number',
    description: 'Number of days to show relative time (e.g., "2 days ago")',
    category: CONFIG_CATEGORIES.DATE,
    min: 1,
    max: 365,
  },
  {
    key: 'DATE_FULL_DATE_THRESHOLD_DAYS',
    defaultValue: 365,
    type: 'number',
    description: 'Number of days to show month/day format vs full date',
    category: CONFIG_CATEGORIES.DATE,
    min: 30,
    max: 3650,
  },
  {
    key: 'HEALTH_REFRESH_INTERVAL_MS',
    defaultValue: 5000,
    type: 'number',
    description: 'Auto-refresh interval for health status updates (in milliseconds)',
    category: CONFIG_CATEGORIES.HEALTH,
    min: 1000,
    max: 300000,
  },
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

const CONFIG_STORAGE_KEY = 'advancedConfig';

let configOverrides: Record<string, number | string | boolean> = {};
let overridesLoaded = false;

const registryMap = new Map<string, ConfigEntry>(
  CONFIG_REGISTRY.map(entry => [entry.key, entry])
);

let configCache: Record<string, number | string | boolean> = {};

function rebuildConfigCache(): void {
  configCache = {};
  for (const entry of CONFIG_REGISTRY) {
    configCache[entry.key] = entry.key in configOverrides
      ? configOverrides[entry.key]
      : entry.defaultValue;
  }
}

rebuildConfigCache();

export async function loadConfigOverrides(): Promise<void> {
  try {
    const stored = await db.settings.get(CONFIG_STORAGE_KEY);
    if (stored?.value !== undefined) {
      configOverrides = stored.value as Record<string, string | number | boolean>;
    }
    overridesLoaded = true;
    rebuildConfigCache();
  } catch (error) {
    console.error('Failed to load config overrides:', error);
    configOverrides = {};
    overridesLoaded = true;
    rebuildConfigCache();
  }
}

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

export function getConfigValue(key: string): number | string | boolean {
  if (!registryMap.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  return configCache[key];
}

export async function setConfigValue(key: string, value: number | string | boolean): Promise<void> {
  const entry = registryMap.get(key);
  if (!entry) {
    throw new Error(`Unknown config key: ${key}`);
  }

  if (typeof value !== entry.type) {
    throw new Error(`Invalid type for ${key}: expected ${entry.type}, got ${typeof value}`);
  }

  if (entry.type === 'number' && typeof value === 'number') {
    if (entry.min !== undefined && value < entry.min) {
      throw new Error(`Value for ${key} must be at least ${entry.min}`);
    }
    if (entry.max !== undefined && value > entry.max) {
      throw new Error(`Value for ${key} must be at most ${entry.max}`);
    }
  }

  configOverrides[key] = value;
  rebuildConfigCache();
  await saveConfigOverrides();
}

export async function resetConfigValue(key: string): Promise<void> {
  if (!registryMap.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete configOverrides[key];
  rebuildConfigCache();
  await saveConfigOverrides();
}

export async function resetAllConfigValues(): Promise<void> {
  configOverrides = {};
  rebuildConfigCache();
  await saveConfigOverrides();
}

export function isConfigModified(key: string): boolean {
  return key in configOverrides;
}

export function getAllConfigEntries(): (ConfigEntry & { currentValue: number | string | boolean; isModified: boolean })[] {
  return CONFIG_REGISTRY.map(entry => ({
    ...entry,
    currentValue: getConfigValue(entry.key),
    isModified: isConfigModified(entry.key),
  }));
}

export function getConfigEntriesByCategory(category: string): (ConfigEntry & { currentValue: number | string | boolean; isModified: boolean })[] {
  return getAllConfigEntries().filter(entry => entry.category === category);
}

export function searchConfigEntries(query: string): (ConfigEntry & { currentValue: number | string | boolean; isModified: boolean })[] {
  const lowerQuery = query.toLowerCase();
  return getAllConfigEntries().filter(entry =>
    entry.key.toLowerCase().includes(lowerQuery) ||
    entry.description.toLowerCase().includes(lowerQuery)
  );
}

export function getModifiedCount(): number {
  return Object.keys(configOverrides).length;
}

export async function ensureConfigLoaded(): Promise<void> {
  if (!overridesLoaded) {
    await loadConfigOverrides();
  }
}

export interface ConfigValues {
  FETCH_CONCURRENCY: number;
  FETCH_TIMEOUT_MS: number;
  FETCH_MAX_HTML_SIZE: number;
  FETCH_OFFSCREEN_BUFFER_MS: number;
  PAGE_SETTLE_TIME_MS: number;
  PAGE_SETTLE_MAX_MULTIPLIER: number;
  TAB_CREATION_DELAY_MS: number;
  DEFAULT_API_BASE_URL: string;
  API_CONTENT_MAX_CHARS: number;
  API_CHAT_TEMPERATURE: number;
  API_CHAT_USE_TEMPERATURE: boolean;
  QA_SYSTEM_PROMPT: string;
  SEARCH_HISTORY_LIMIT: number;
  SEARCH_AUTOCOMPLETE_LIMIT: number;
  SEARCH_TOP_K_RESULTS: number;
  QUEUE_PROCESSING_TIMEOUT_MS: number;
  QUEUE_STATE_TIMEOUT_MS: number;
  QUEUE_MAX_RETRIES: number;
  QUEUE_RETRY_BASE_DELAY_MS: number;
  QUEUE_RETRY_MAX_DELAY_MS: number;
  PROCESSOR_QA_GENERATION_PROGRESS: number;
  PROCESSOR_QA_SAVING_PROGRESS: number;
  WEBDAV_SYNC_TIMEOUT_MS: number;
  WEBDAV_SYNC_DEBOUNCE_MS: number;
  STUMBLE_COUNT: number;
  DATE_RELATIVE_TIME_THRESHOLD_DAYS: number;
  DATE_FULL_DATE_THRESHOLD_DAYS: number;
  HEALTH_REFRESH_INTERVAL_MS: number;
  SIMILARITY_THRESHOLD_EXCELLENT: number;
  SIMILARITY_THRESHOLD_GOOD: number;
  SIMILARITY_THRESHOLD_FAIR: number;
  SIMILARITY_THRESHOLD_POOR: number;
}

export const CONFIG_DEFAULTS: ConfigValues = CONFIG_REGISTRY.reduce((acc, entry) => {
  acc[entry.key as keyof ConfigValues] = entry.defaultValue as never;
  return acc;
}, {} as ConfigValues);

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const config: ConfigValues = Object.create(null);

CONFIG_REGISTRY.forEach(entry => {
  Object.defineProperty(config, entry.key, {
    get(): number | string | boolean {
      return getConfigValue(entry.key);
    },
    enumerable: true,
    configurable: false,
  });
});
