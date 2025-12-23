/**
 * Integration test for Configuration Management cooperation in Effect.ts refactored codebase
 *
 * This test validates how configuration flows between modules and ensures proper:
 * - ConfigService layer provision
 * - Configuration value retrieval
 * - Configuration updates propagating to consumers
 * - Validation errors being properly typed
 * - Storage layer isolation via mocking
 *
 * Modules involved:
 * - services/config-service
 * - lib/config-registry
 * - lib/api (consumer)
 * - lib/similarity (consumer)
 * - background/queue (consumer)
 * - search/search (consumer)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import * as Context from 'effect/Context';
import {
  ConfigService,
  makeConfigService,
  ConfigServiceLive,
  StorageService,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigStorageError,
  CONFIG_REGISTRY,
  makeConfigProxy,
} from '../effect/lib/config-registry';
import { ConfigService as SimpleConfigService } from '../effect/services/config-service';
import { LoggingService } from '../effect/services/logging-service';
import { findTopK } from '../effect/lib/similarity';

// ============================================================================
// Mock Storage Layer
// ============================================================================

/**
 * Create a mock storage service for testing isolation
 */
function createMockStorageService(
  initialData: Record<string, unknown> = {}
): StorageService {
  const storage = new Map<string, unknown>(Object.entries(initialData));

  return {
    get: <T>(key: string) =>
      Effect.sync(() => storage.get(key) as T | undefined),

    put: <T>(key: string, value: T) =>
      Effect.sync(() => {
        storage.set(key, value);
      }),
  };
}

/**
 * Create a mock storage service that fails
 */
function createFailingStorageService(
  operation: 'load' | 'save' | 'both'
): StorageService {
  return {
    get: <T>(key: string) =>
      operation === 'load' || operation === 'both'
        ? Effect.fail(
            new ConfigStorageError({
              operation: 'load',
              message: 'Mock storage load failure',
            })
          )
        : Effect.succeed(undefined as T | undefined),

    put: <T>(key: string, value: T) =>
      operation === 'save' || operation === 'both'
        ? Effect.fail(
            new ConfigStorageError({
              operation: 'save',
              message: 'Mock storage save failure',
            })
          )
        : Effect.succeed(undefined),
  };
}

// ============================================================================
// Mock Logging Service
// ============================================================================

/**
 * Create a mock logging service for testing
 */
function createMockLoggingService(): Context.Tag.Service<LoggingService> {
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];

  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'debug', message, context });
      }),
    info: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'info', message, context });
      }),
    warn: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'warn', message, context });
      }),
    error: (message: string, context?: Record<string, unknown>) =>
      Effect.sync(() => {
        logs.push({ level: 'error', message, context });
      }),
  };
}

const MockLoggingServiceLive = Layer.succeed(LoggingService, createMockLoggingService());

// ============================================================================
// Test Suite
// ============================================================================

describe('Configuration Management Integration', () => {
  // ============================================================================
  // Layer Provision Tests
  // ============================================================================

  describe('ConfigService Layer Provision', () => {
    it('should provision ConfigService layer with mock storage', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return config;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result).toBeDefined();
      expect(result.getValue).toBeDefined();
      expect(result.setValue).toBeDefined();
      expect(result.loadOverrides).toBeDefined();
    });

    it('should load initial configuration from storage', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          FETCH_CONCURRENCY: 10,
          API_CONTENT_MAX_CHARS: 20000,
        },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;
        const fetchConcurrency = yield* config.getValue('FETCH_CONCURRENCY');
        const contentMaxChars = yield* config.getValue('API_CONTENT_MAX_CHARS');
        return { fetchConcurrency, contentMaxChars };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.fetchConcurrency).toBe(10);
      expect(result.contentMaxChars).toBe(20000);
    });

    it('should handle missing storage data gracefully', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;
        // Should return default value when no override exists
        const fetchConcurrency = yield* config.getValue('FETCH_CONCURRENCY');
        return fetchConcurrency;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      // Should return default value from CONFIG_REGISTRY
      const defaultEntry = CONFIG_REGISTRY.find((e) => e.key === 'FETCH_CONCURRENCY');
      expect(result).toBe(defaultEntry?.defaultValue);
    });
  });

  // ============================================================================
  // Configuration Value Retrieval Tests
  // ============================================================================

  describe('Configuration Value Retrieval', () => {
    it('should retrieve default values for all config keys', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      for (const entry of CONFIG_REGISTRY) {
        const program = Effect.gen(function* () {
          const config = yield* ConfigService;
          yield* config.ensureLoaded;
          return yield* config.getValue(entry.key);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(configLayer))
        );

        expect(result).toBe(entry.defaultValue);
      }
    });

    it('should retrieve overridden values when present', async () => {
      const overrides = {
        FETCH_CONCURRENCY: 15,
        API_CONTENT_MAX_CHARS: 25000,
        SEARCH_TOP_K_RESULTS: 300,
      };

      const mockStorage = createMockStorageService({
        advancedConfig: overrides,
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;

        const fetchConcurrency = yield* config.getValue('FETCH_CONCURRENCY');
        const contentMaxChars = yield* config.getValue('API_CONTENT_MAX_CHARS');
        const topKResults = yield* config.getValue('SEARCH_TOP_K_RESULTS');

        return { fetchConcurrency, contentMaxChars, topKResults };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.fetchConcurrency).toBe(15);
      expect(result.contentMaxChars).toBe(25000);
      expect(result.topKResults).toBe(300);
    });

    it('should fail with ConfigNotFoundError for unknown keys', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return yield* config.getValue('UNKNOWN_KEY');
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigNotFoundError);
        expect(result.left.key).toBe('UNKNOWN_KEY');
      }
    });

    it('should support type-safe retrieval', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        const fetchConcurrency = yield* config.getValue('FETCH_CONCURRENCY');
        const apiBaseUrl = yield* config.getValue('DEFAULT_API_BASE_URL');
        const useTemperature = yield* config.getValue('API_CHAT_USE_TEMPERATURE');

        return { fetchConcurrency, apiBaseUrl, useTemperature };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(typeof result.fetchConcurrency).toBe('number');
      expect(typeof result.apiBaseUrl).toBe('string');
      expect(typeof result.useTemperature).toBe('boolean');
    });
  });

  // ============================================================================
  // Configuration Update Tests
  // ============================================================================

  describe('Configuration Updates', () => {
    it('should update configuration values', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // Get initial value
        const initial = yield* config.getValue('FETCH_CONCURRENCY');

        // Update value
        yield* config.setValue('FETCH_CONCURRENCY', 20);

        // Get updated value
        const updated = yield* config.getValue('FETCH_CONCURRENCY');

        return { initial, updated };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.initial).toBe(5); // Default value
      expect(result.updated).toBe(20);
    });

    it('should persist updates to storage', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        yield* config.setValue('FETCH_CONCURRENCY', 20);
        yield* config.setValue('API_CONTENT_MAX_CHARS', 30000);

        // Should trigger save
        yield* config.saveOverrides;
      });

      await Effect.runPromise(program.pipe(Effect.provide(configLayer)));

      // Verify storage was updated
      const storedValue = await Effect.runPromise(
        mockStorage.get<Record<string, unknown>>('advancedConfig')
      );

      expect(storedValue).toEqual({
        FETCH_CONCURRENCY: 20,
        API_CONTENT_MAX_CHARS: 30000,
      });
    });

    it('should propagate updates to all consumers', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // Update a value
        yield* config.setValue('SEARCH_TOP_K_RESULTS', 500);

        // Multiple consumers read the same config
        const value1 = yield* config.getValue('SEARCH_TOP_K_RESULTS');
        const value2 = yield* config.getValue('SEARCH_TOP_K_RESULTS');
        const value3 = yield* config.getValue('SEARCH_TOP_K_RESULTS');

        return { value1, value2, value3 };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.value1).toBe(500);
      expect(result.value2).toBe(500);
      expect(result.value3).toBe(500);
    });

    it('should support resetting individual values', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: { FETCH_CONCURRENCY: 20 },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;

        const overridden = yield* config.getValue('FETCH_CONCURRENCY');

        yield* config.resetValue('FETCH_CONCURRENCY');

        const reset = yield* config.getValue('FETCH_CONCURRENCY');

        return { overridden, reset };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.overridden).toBe(20);
      expect(result.reset).toBe(5); // Default value
    });

    it('should support resetting all values', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          FETCH_CONCURRENCY: 20,
          API_CONTENT_MAX_CHARS: 30000,
        },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;

        yield* config.resetAll;

        const concurrency = yield* config.getValue('FETCH_CONCURRENCY');
        const maxChars = yield* config.getValue('API_CONTENT_MAX_CHARS');

        return { concurrency, maxChars };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      // Should return default values
      expect(result.concurrency).toBe(5);
      expect(result.maxChars).toBe(15000);
    });

    it('should track modification status', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        const beforeModified = yield* config.isModified('FETCH_CONCURRENCY');

        yield* config.setValue('FETCH_CONCURRENCY', 20);

        const afterModified = yield* config.isModified('FETCH_CONCURRENCY');

        return { beforeModified, afterModified };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.beforeModified).toBe(false);
      expect(result.afterModified).toBe(true);
    });
  });

  // ============================================================================
  // Validation Error Tests
  // ============================================================================

  describe('Validation Errors', () => {
    it('should validate type constraints', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // Try to set a number field to a string
        return yield* config.setValue('FETCH_CONCURRENCY', 'not a number' as any);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigValidationError);
        expect(result.left.key).toBe('FETCH_CONCURRENCY');
        expect(result.left.reason).toContain('Invalid type');
        expect(result.left.expectedType).toBe('number');
        expect(result.left.actualType).toBe('string');
      }
    });

    it('should validate minimum constraints', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // FETCH_CONCURRENCY has min: 1
        return yield* config.setValue('FETCH_CONCURRENCY', 0);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigValidationError);
        expect(result.left.key).toBe('FETCH_CONCURRENCY');
        expect(result.left.reason).toContain('at least');
        expect(result.left.min).toBe(1);
      }
    });

    it('should validate maximum constraints', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // FETCH_CONCURRENCY has max: 50
        return yield* config.setValue('FETCH_CONCURRENCY', 100);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigValidationError);
        expect(result.left.key).toBe('FETCH_CONCURRENCY');
        expect(result.left.reason).toContain('at most');
        expect(result.left.max).toBe(50);
      }
    });

    it('should validate unknown keys', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        return yield* config.setValue('UNKNOWN_KEY', 42);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigValidationError);
        expect(result.left.key).toBe('UNKNOWN_KEY');
        expect(result.left.reason).toContain('Unknown config key');
      }
    });

    it('should accept valid values within constraints', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // Valid values within min/max
        yield* config.setValue('FETCH_CONCURRENCY', 10);
        yield* config.setValue('API_CONTENT_MAX_CHARS', 20000);
        yield* config.setValue('API_CHAT_USE_TEMPERATURE', false);

        const concurrency = yield* config.getValue('FETCH_CONCURRENCY');
        const maxChars = yield* config.getValue('API_CONTENT_MAX_CHARS');
        const useTemp = yield* config.getValue('API_CHAT_USE_TEMPERATURE');

        return { concurrency, maxChars, useTemp };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.concurrency).toBe(10);
      expect(result.maxChars).toBe(20000);
      expect(result.useTemp).toBe(false);
    });
  });

  // ============================================================================
  // Storage Error Handling Tests
  // ============================================================================

  describe('Storage Error Handling', () => {
    it('should handle storage load failures', async () => {
      const failingStorage = createFailingStorageService('load');
      const configLayer = ConfigServiceLive(failingStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        return yield* config.loadOverrides;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigStorageError);
        expect(result.left.operation).toBe('load');
      }
    });

    it('should handle storage save failures', async () => {
      const failingStorage = createFailingStorageService('save');
      const configLayer = ConfigServiceLive(failingStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;
        return yield* config.setValue('FETCH_CONCURRENCY', 10);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ConfigStorageError);
        expect(result.left.operation).toBe('save');
      }
    });

    it('should provide default values when load fails', async () => {
      const failingStorage = createFailingStorageService('load');
      const configLayer = ConfigServiceLive(failingStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;

        // Load will fail, but ensureLoaded handles it
        yield* config.loadOverrides.pipe(Effect.catchAll(() => Effect.succeed(undefined)));

        // Should still return default values
        const concurrency = yield* config.getValue('FETCH_CONCURRENCY');
        return concurrency;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result).toBe(5); // Default value
    });
  });

  // ============================================================================
  // Consumer Integration Tests
  // ============================================================================

  describe('Consumer Integration', () => {
    it('should integrate with similarity module', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          SIMILARITY_THRESHOLD_EXCELLENT: 0.95,
          SIMILARITY_THRESHOLD_GOOD: 0.8,
        },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      // Create a simple ConfigService bridge for similarity module
      const simpleConfigLayer = Layer.effect(
        SimpleConfigService,
        Effect.gen(function* () {
          const fullConfig = yield* ConfigService;
          // Load overrides first
          yield* fullConfig.loadOverrides;
          return {
            get: <T>(key: string) =>
              fullConfig.getValue(key).pipe(
                Effect.map((v) => v as T),
                Effect.catchAll((error) =>
                  Effect.fail({
                    code: 'INVALID_CONFIG' as const,
                    key,
                    message: `Config error: ${error}`,
                  })
                )
              ),
          };
        })
      ).pipe(Layer.provide(configLayer));

      const testLayer = Layer.mergeAll(simpleConfigLayer, MockLoggingServiceLive);

      const program = Effect.gen(function* () {
        const config = yield* SimpleConfigService;

        // Test that similarity module can read config
        const excellentThreshold = yield* config.get<number>('SIMILARITY_THRESHOLD_EXCELLENT');
        const goodThreshold = yield* config.get<number>('SIMILARITY_THRESHOLD_GOOD');

        return { excellentThreshold, goodThreshold };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result.excellentThreshold).toBe(0.95);
      expect(result.goodThreshold).toBe(0.8);
    });

    it('should support concurrent access from multiple consumers', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          FETCH_CONCURRENCY: 10,
          API_CONTENT_MAX_CHARS: 20000,
          SEARCH_TOP_K_RESULTS: 300,
        },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;

        // Simulate multiple consumers reading config concurrently
        const results = yield* Effect.all(
          [
            config.getValue('FETCH_CONCURRENCY'),
            config.getValue('API_CONTENT_MAX_CHARS'),
            config.getValue('SEARCH_TOP_K_RESULTS'),
            config.getValue('FETCH_CONCURRENCY'), // Same key again
            config.getValue('API_CONTENT_MAX_CHARS'), // Same key again
          ],
          { concurrency: 'unbounded' }
        );

        return results;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result).toEqual([10, 20000, 300, 10, 20000]);
    });

    it('should maintain consistency across updates and reads', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        // Sequential updates and reads
        yield* config.setValue('FETCH_CONCURRENCY', 10);
        const read1 = yield* config.getValue('FETCH_CONCURRENCY');

        yield* config.setValue('FETCH_CONCURRENCY', 20);
        const read2 = yield* config.getValue('FETCH_CONCURRENCY');

        yield* config.setValue('FETCH_CONCURRENCY', 30);
        const read3 = yield* config.getValue('FETCH_CONCURRENCY');

        return { read1, read2, read3 };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.read1).toBe(10);
      expect(result.read2).toBe(20);
      expect(result.read3).toBe(30);
    });
  });

  // ============================================================================
  // Advanced Features Tests
  // ============================================================================

  describe('Advanced Features', () => {
    it('should support getAllEntries with metadata', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          FETCH_CONCURRENCY: 10,
          API_CONTENT_MAX_CHARS: 20000,
        },
      });
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.loadOverrides;

        return yield* config.getAllEntries;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.length).toBe(CONFIG_REGISTRY.length);

      const fetchConcurrencyEntry = result.find((e) => e.key === 'FETCH_CONCURRENCY');
      expect(fetchConcurrencyEntry?.currentValue).toBe(10);
      expect(fetchConcurrencyEntry?.isModified).toBe(true);

      const searchLimitEntry = result.find((e) => e.key === 'SEARCH_HISTORY_LIMIT');
      expect(searchLimitEntry?.currentValue).toBe(50); // Default
      expect(searchLimitEntry?.isModified).toBe(false);
    });

    it('should support searchEntries', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        return yield* config.searchEntries('fetch');
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      // Should find all entries related to "fetch"
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((e) =>
        e.key.toLowerCase().includes('fetch') ||
        e.description.toLowerCase().includes('fetch')
      )).toBe(true);
    });

    it('should support getModifiedCount', async () => {
      const mockStorage = createMockStorageService();
      const configLayer = ConfigServiceLive(mockStorage);

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        yield* config.ensureLoaded;

        const initialCount = yield* config.getModifiedCount;

        yield* config.setValue('FETCH_CONCURRENCY', 10);
        const afterOne = yield* config.getModifiedCount;

        yield* config.setValue('API_CONTENT_MAX_CHARS', 20000);
        const afterTwo = yield* config.getModifiedCount;

        yield* config.resetValue('FETCH_CONCURRENCY');
        const afterReset = yield* config.getModifiedCount;

        return { initialCount, afterOne, afterTwo, afterReset };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(configLayer))
      );

      expect(result.initialCount).toBe(0);
      expect(result.afterOne).toBe(1);
      expect(result.afterTwo).toBe(2);
      expect(result.afterReset).toBe(1);
    });
  });

  // ============================================================================
  // Config Proxy Tests
  // ============================================================================

  describe('Config Proxy', () => {
    it('should create a synchronous config proxy', async () => {
      const mockStorage = createMockStorageService({
        advancedConfig: {
          FETCH_CONCURRENCY: 15,
        },
      });

      const configService = await Effect.runPromise(
        makeConfigService(mockStorage).pipe(
          Effect.flatMap((service) =>
            service.loadOverrides.pipe(Effect.map(() => service))
          )
        )
      );

      const proxy = makeConfigProxy(configService);

      expect(proxy.FETCH_CONCURRENCY).toBe(15);
      expect(proxy.API_CONTENT_MAX_CHARS).toBe(15000); // Default
      expect(proxy.API_CHAT_USE_TEMPERATURE).toBe(true); // Default
    });

    it('should reflect updates through proxy', async () => {
      const mockStorage = createMockStorageService();

      const configService = await Effect.runPromise(
        makeConfigService(mockStorage).pipe(
          Effect.flatMap((service) =>
            service.ensureLoaded.pipe(Effect.map(() => service))
          )
        )
      );

      const proxy = makeConfigProxy(configService);

      const initial = proxy.FETCH_CONCURRENCY;

      await Effect.runPromise(
        configService.setValue('FETCH_CONCURRENCY', 25)
      );

      const updated = proxy.FETCH_CONCURRENCY;

      expect(initial).toBe(5); // Default
      expect(updated).toBe(25);
    });

    it('should handle errors gracefully in proxy', async () => {
      const mockStorage = createMockStorageService();

      const configService = await Effect.runPromise(
        makeConfigService(mockStorage)
      );

      const proxy = makeConfigProxy(configService);

      // Even if not loaded, proxy should return defaults
      expect(() => proxy.FETCH_CONCURRENCY).not.toThrow();
      expect(proxy.FETCH_CONCURRENCY).toBe(5);
    });
  });
});
