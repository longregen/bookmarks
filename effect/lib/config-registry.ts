import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import * as Ref from 'effect/Ref';
import { db } from '../../src/db/schema';

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

export interface ConfigEntryWithMetadata extends ConfigEntry {
  currentValue: number | string | boolean;
  isModified: boolean;
}

export class ConfigNotFoundError extends Data.TaggedError('ConfigNotFoundError')<{
  readonly key: string;
}> {}

export class ConfigValidationError extends Data.TaggedError('ConfigValidationError')<{
  readonly key: string;
  readonly reason: string;
  readonly expectedType?: string;
  readonly actualType?: string;
  readonly min?: number;
  readonly max?: number;
  readonly value?: unknown;
}> {}

export class ConfigStorageError extends Data.TaggedError('ConfigStorageError')<{
  readonly operation: 'load' | 'save';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface StorageService {
  readonly get: <T>(key: string) => Effect.Effect<T | undefined, ConfigStorageError>;
  readonly put: <T>(key: string, value: T) => Effect.Effect<void, ConfigStorageError>;
}

export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    readonly loadOverrides: Effect.Effect<void, ConfigStorageError>;
    readonly saveOverrides: Effect.Effect<void, ConfigStorageError>;
    readonly getValue: (key: string) => Effect.Effect<number | string | boolean, ConfigNotFoundError>;
    readonly setValue: (key: string, value: number | string | boolean) => Effect.Effect<void, ConfigValidationError | ConfigStorageError>;
    readonly resetValue: (key: string) => Effect.Effect<void, ConfigNotFoundError | ConfigStorageError>;
    readonly resetAll: Effect.Effect<void, ConfigStorageError>;
    readonly isModified: (key: string) => Effect.Effect<boolean>;
    readonly getAllEntries: Effect.Effect<ConfigEntryWithMetadata[]>;
    readonly searchEntries: (query: string) => Effect.Effect<ConfigEntryWithMetadata[]>;
    readonly getModifiedCount: Effect.Effect<number>;
    readonly ensureLoaded: Effect.Effect<void, ConfigStorageError>;
  }
>() {}

const CONFIG_STORAGE_KEY = 'advancedConfig';

const registryMap = new Map<string, ConfigEntry>(
  CONFIG_REGISTRY.map(entry => [entry.key, entry])
);

interface ConfigState {
  overrides: Record<string, number | string | boolean>;
  loaded: boolean;
  cache: Record<string, number | string | boolean>;
}

function buildConfigCache(overrides: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
  const cache: Record<string, number | string | boolean> = {};
  for (const entry of CONFIG_REGISTRY) {
    cache[entry.key] = entry.key in overrides
      ? overrides[entry.key]
      : entry.defaultValue;
  }
  return cache;
}

function validateConfigValue(
  entry: ConfigEntry,
  value: number | string | boolean
): Effect.Effect<void, ConfigValidationError> {
  return Effect.gen(function* () {
    if (typeof value !== entry.type) {
      return yield* Effect.fail(
        new ConfigValidationError({
          key: entry.key,
          reason: `Invalid type: expected ${entry.type}, got ${typeof value}`,
          expectedType: entry.type,
          actualType: typeof value,
          value,
        })
      );
    }

    if (entry.type === 'number' && typeof value === 'number') {
      if (entry.min !== undefined && value < entry.min) {
        return yield* Effect.fail(
          new ConfigValidationError({
            key: entry.key,
            reason: `Value must be at least ${entry.min}`,
            min: entry.min,
            value,
          })
        );
      }
      if (entry.max !== undefined && value > entry.max) {
        return yield* Effect.fail(
          new ConfigValidationError({
            key: entry.key,
            reason: `Value must be at most ${entry.max}`,
            max: entry.max,
            value,
          })
        );
      }
    }
  });
}

export const makeConfigService = (
  storage: StorageService
): Effect.Effect<Context.Tag.Service<ConfigService>, never> =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<ConfigState>({
      overrides: {},
      loaded: false,
      cache: buildConfigCache({}),
    });

    const loadOverrides: Effect.Effect<void, ConfigStorageError> = Effect.gen(function* () {
      const stored = yield* storage.get<Record<string, number | string | boolean>>(CONFIG_STORAGE_KEY);
      const overrides = stored ?? {};

      yield* Ref.update(stateRef, state => ({
        overrides,
        loaded: true,
        cache: buildConfigCache(overrides),
      }));
    }).pipe(
      Effect.catchAll(error =>
        Effect.gen(function* () {
          yield* Ref.update(stateRef, state => ({
            ...state,
            overrides: {},
            loaded: true,
            cache: buildConfigCache({}),
          }));
          return yield* Effect.fail(
            new ConfigStorageError({
              operation: 'load',
              message: 'Failed to load config overrides',
              cause: error,
            })
          );
        })
      )
    );

    const saveOverrides: Effect.Effect<void, ConfigStorageError> = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      yield* storage.put(CONFIG_STORAGE_KEY, state.overrides);
    }).pipe(
      Effect.catchAll(error =>
        new ConfigStorageError({
          operation: 'save',
          message: 'Failed to save config overrides',
          cause: error,
        })
      )
    );

    const getValue = (key: string): Effect.Effect<number | string | boolean, ConfigNotFoundError> =>
      Effect.gen(function* () {
        if (!registryMap.has(key)) {
          return yield* Effect.fail(new ConfigNotFoundError({ key }));
        }

        const state = yield* Ref.get(stateRef);
        return state.cache[key];
      });

    const setValue = (
      key: string,
      value: number | string | boolean
    ): Effect.Effect<void, ConfigValidationError | ConfigStorageError> =>
      Effect.gen(function* () {
        const entry = registryMap.get(key);
        if (!entry) {
          return yield* Effect.fail(
            new ConfigValidationError({
              key,
              reason: 'Unknown config key',
            })
          );
        }

        yield* validateConfigValue(entry, value);

        yield* Ref.update(stateRef, state => {
          const newOverrides = { ...state.overrides, [key]: value };
          return {
            ...state,
            overrides: newOverrides,
            cache: buildConfigCache(newOverrides),
          };
        });

        yield* saveOverrides;
      });

    const resetValue = (key: string): Effect.Effect<void, ConfigNotFoundError | ConfigStorageError> =>
      Effect.gen(function* () {
        if (!registryMap.has(key)) {
          return yield* Effect.fail(new ConfigNotFoundError({ key }));
        }

        yield* Ref.update(stateRef, state => {
          const newOverrides = { ...state.overrides };
          delete newOverrides[key];
          return {
            ...state,
            overrides: newOverrides,
            cache: buildConfigCache(newOverrides),
          };
        });

        yield* saveOverrides;
      });

    const resetAll: Effect.Effect<void, ConfigStorageError> = Effect.gen(function* () {
      yield* Ref.update(stateRef, state => ({
        ...state,
        overrides: {},
        cache: buildConfigCache({}),
      }));

      yield* saveOverrides;
    });

    const isModified = (key: string): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        return key in state.overrides;
      });

    const getAllEntries: Effect.Effect<ConfigEntryWithMetadata[]> = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      return CONFIG_REGISTRY.map(entry => ({
        ...entry,
        currentValue: state.cache[entry.key],
        isModified: entry.key in state.overrides,
      }));
    });

    const searchEntries = (query: string): Effect.Effect<ConfigEntryWithMetadata[]> =>
      Effect.gen(function* () {
        const allEntries = yield* getAllEntries;
        const lowerQuery = query.toLowerCase();
        return allEntries.filter(entry =>
          entry.key.toLowerCase().includes(lowerQuery) ||
          entry.description.toLowerCase().includes(lowerQuery)
        );
      });

    const getModifiedCount: Effect.Effect<number> = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      return Object.keys(state.overrides).length;
    });

    const ensureLoaded: Effect.Effect<void, ConfigStorageError> = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (!state.loaded) {
        yield* loadOverrides;
      }
    });

    return {
      loadOverrides,
      saveOverrides,
      getValue,
      setValue,
      resetValue,
      resetAll,
      isModified,
      getAllEntries,
      searchEntries,
      getModifiedCount,
      ensureLoaded,
    };
  });

const makeDexieStorageService = (): StorageService => ({
  get: <T>(key: string) =>
    Effect.tryPromise({
      try: async () => {
        const result = await db.settings.get(key);
        return result?.value as T | undefined;
      },
      catch: (error) =>
        new ConfigStorageError({
          operation: 'load',
          message: `Failed to get setting: ${key}`,
          cause: error,
        }),
    }),
  put: <T>(key: string, value: T) =>
    Effect.tryPromise({
      try: async () => {
        const now = new Date();
        await db.settings.put({
          key,
          value: value as never,
          createdAt: now,
          updatedAt: now,
        });
      },
      catch: (error) =>
        new ConfigStorageError({
          operation: 'save',
          message: `Failed to put setting: ${key}`,
          cause: error,
        }),
    }),
});

export const ConfigServiceLive = (storage: StorageService): Layer.Layer<ConfigService> =>
  Layer.effect(
    ConfigService,
    makeConfigService(storage)
  );

export const ConfigServiceLiveWithDexie: Layer.Layer<ConfigService> =
  Layer.effect(
    ConfigService,
    makeConfigService(makeDexieStorageService())
  );

export const makeConfigProxy = (
  configService: Context.Tag.Service<ConfigService>
): ConfigValues => {
  const proxy = Object.create(null) as ConfigValues;

  CONFIG_REGISTRY.forEach(entry => {
    Object.defineProperty(proxy, entry.key, {
      get(): number | string | boolean {
        const effect = configService.getValue(entry.key);
        const result = Effect.runSync(effect.pipe(
          Effect.catchAll(() => Effect.succeed(entry.defaultValue))
        ));
        return result;
      },
      enumerable: true,
      configurable: false,
    });
  });

  return proxy;
};
