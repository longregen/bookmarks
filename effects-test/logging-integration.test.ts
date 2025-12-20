import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Ref from 'effect/Ref';
import { LoggingService } from '../effect/services/logging-service';

// ============================================================================
// Test Utilities - Mock Log Capture
// ============================================================================

/**
 * Captured log entry for testing
 */
interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: Date;
}

/**
 * Test implementation of LoggingService that captures logs in memory
 */
const createTestLoggingService = (logRef: Ref.Ref<LogEntry[]>) => ({
  debug: (message: string, context?: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* Ref.update(logRef, (logs) => [
        ...logs,
        { level: 'debug', message, context, timestamp: new Date() },
      ]);
    }),

  info: (message: string, context?: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* Ref.update(logRef, (logs) => [
        ...logs,
        { level: 'info', message, context, timestamp: new Date() },
      ]);
    }),

  warn: (message: string, context?: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* Ref.update(logRef, (logs) => [
        ...logs,
        { level: 'warn', message, context, timestamp: new Date() },
      ]);
    }),

  error: (message: string, context?: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* Ref.update(logRef, (logs) => [
        ...logs,
        { level: 'error', message, context, timestamp: new Date() },
      ]);
    }),
});

/**
 * Create a test logging layer that captures logs
 */
const makeTestLoggingLayer = (logRef: Ref.Ref<LogEntry[]>) =>
  Layer.succeed(LoggingService, createTestLoggingService(logRef));

// ============================================================================
// Mock Services for Integration Testing
// ============================================================================

/**
 * Mock data service that uses LoggingService
 */
class DataService extends Context.Tag('DataService')<
  DataService,
  {
    readonly fetchData: (id: string) => Effect.Effect<string, Error, never>;
    readonly saveData: (id: string, data: string) => Effect.Effect<void, Error, never>;
  }
>() {}

/**
 * Mock processor service that uses LoggingService
 */
class ProcessorService extends Context.Tag('ProcessorService')<
  ProcessorService,
  {
    readonly process: (data: string) => Effect.Effect<string, Error, never>;
  }
>() {}

/**
 * Create a mock DataService implementation that uses LoggingService
 */
const makeDataService = Effect.gen(function* () {
  const logging = yield* LoggingService;

  return {
    fetchData: (id: string) =>
      Effect.gen(function* () {
        yield* logging.debug('Fetching data', { id });

        if (id === 'error') {
          yield* logging.error('Failed to fetch data', { id, reason: 'Not found' });
          return yield* Effect.fail(new Error('Data not found'));
        }

        yield* logging.info('Data fetched successfully', { id });
        return `data-${id}`;
      }),

    saveData: (id: string, data: string) =>
      Effect.gen(function* () {
        yield* logging.debug('Saving data', { id, dataLength: data.length });
        yield* logging.info('Data saved successfully', { id });
      }),
  };
});

const DataServiceLive = Layer.effect(DataService, makeDataService);

/**
 * Create a mock ProcessorService implementation that uses LoggingService
 */
const makeProcessorService = Effect.gen(function* () {
  const logging = yield* LoggingService;

  return {
    process: (data: string) =>
      Effect.gen(function* () {
        yield* logging.debug('Processing data', { dataLength: data.length });

        if (data.includes('invalid')) {
          yield* logging.warn('Invalid data detected', { data });
          return yield* Effect.fail(new Error('Invalid data'));
        }

        const processed = data.toUpperCase();
        yield* logging.info('Data processed', { originalLength: data.length, processedLength: processed.length });
        return processed;
      }),
  };
});

const ProcessorServiceLive = Layer.effect(ProcessorService, makeProcessorService);

// ============================================================================
// Integration Tests
// ============================================================================

describe('LoggingService Integration Tests', () => {
  let logRef: Ref.Ref<LogEntry[]>;
  let testLoggingLayer: Layer.Layer<LoggingService>;

  beforeEach(async () => {
    // Create a fresh log ref for each test
    logRef = await Effect.runPromise(Ref.make<LogEntry[]>([]));
    testLoggingLayer = makeTestLoggingLayer(logRef);
  });

  describe('Basic LoggingService Usage', () => {
    it('should log debug messages with context', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.debug('Debug message', { key: 'value', count: 42 });
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('debug');
      expect(logs[0].message).toBe('Debug message');
      expect(logs[0].context).toEqual({ key: 'value', count: 42 });
    });

    it('should log info messages without context', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.info('Info message');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('info');
      expect(logs[0].message).toBe('Info message');
      expect(logs[0].context).toBeUndefined();
    });

    it('should log warn messages', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.warn('Warning message', { severity: 'medium' });
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toBe('Warning message');
    });

    it('should log error messages', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.error('Error message', { errorCode: 500 });
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('Error message');
      expect(logs[0].context).toEqual({ errorCode: 500 });
    });

    it('should capture multiple log entries in order', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.debug('First');
        yield* logging.info('Second');
        yield* logging.warn('Third');
        yield* logging.error('Fourth');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs).toHaveLength(4);
      expect(logs[0].message).toBe('First');
      expect(logs[1].message).toBe('Second');
      expect(logs[2].message).toBe('Third');
      expect(logs[3].message).toBe('Fourth');
    });
  });

  describe('Layer Composition - Single Service', () => {
    it('should provide LoggingService to DataService via Layer', async () => {
      const appLayer = Layer.provide(DataServiceLive, testLoggingLayer);

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        const result = yield* dataService.fetchData('test-123');
        return result;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      expect(result).toBe('data-test-123');

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((log) => log.message.includes('Fetching data'))).toBe(true);
      expect(logs.some((log) => log.message.includes('Data fetched successfully'))).toBe(true);
    });

    it('should capture error logs from DataService', async () => {
      const appLayer = Layer.provide(DataServiceLive, testLoggingLayer);

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        return yield* dataService.fetchData('error');
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(appLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');

      const logs = await Effect.runPromise(Ref.get(logRef));
      const errorLogs = logs.filter((log) => log.level === 'error');
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].message).toBe('Failed to fetch data');
      expect(errorLogs[0].context).toEqual({ id: 'error', reason: 'Not found' });
    });
  });

  describe('Layer Composition - Multiple Services Sharing LoggingService', () => {
    it('should share the same LoggingService instance across multiple services', async () => {
      const appLayer = Layer.mergeAll(
        Layer.provide(DataServiceLive, testLoggingLayer),
        Layer.provide(ProcessorServiceLive, testLoggingLayer)
      );

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        const processorService = yield* ProcessorService;

        const data = yield* dataService.fetchData('abc');
        const processed = yield* processorService.process(data);
        yield* dataService.saveData('result', processed);

        return processed;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      expect(result).toBe('DATA-ABC');

      const logs = await Effect.runPromise(Ref.get(logRef));

      // Verify logs from DataService
      expect(logs.some((log) => log.message === 'Fetching data')).toBe(true);
      expect(logs.some((log) => log.message === 'Data fetched successfully')).toBe(true);

      // Verify logs from ProcessorService
      expect(logs.some((log) => log.message === 'Processing data')).toBe(true);
      expect(logs.some((log) => log.message === 'Data processed')).toBe(true);

      // Verify logs from DataService save
      expect(logs.some((log) => log.message === 'Saving data')).toBe(true);
      expect(logs.some((log) => log.message === 'Data saved successfully')).toBe(true);
    });

    it('should capture logs from multiple services in execution order', async () => {
      const appLayer = Layer.mergeAll(
        Layer.provide(DataServiceLive, testLoggingLayer),
        Layer.provide(ProcessorServiceLive, testLoggingLayer)
      );

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        const processorService = yield* ProcessorService;

        yield* dataService.fetchData('item-1');
        yield* processorService.process('data-item-1');
        yield* dataService.fetchData('item-2');
      });

      await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));
      const messages = logs.map((log) => log.message);

      // Verify execution order
      expect(messages.indexOf('Fetching data')).toBeLessThan(
        messages.indexOf('Data fetched successfully')
      );
      expect(messages.indexOf('Data fetched successfully')).toBeLessThan(
        messages.indexOf('Processing data')
      );
    });
  });

  describe('Error Handling with Logging', () => {
    it('should log errors and continue execution', async () => {
      const appLayer = Layer.provide(ProcessorServiceLive, testLoggingLayer);

      const program = Effect.gen(function* () {
        const processor = yield* ProcessorService;

        // First attempt - will fail
        const result1 = yield* processor.process('invalid data').pipe(
          Effect.catchAll((error) => Effect.succeed('fallback'))
        );

        // Second attempt - will succeed
        const result2 = yield* processor.process('valid data');

        return { result1, result2 };
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      expect(result.result1).toBe('fallback');
      expect(result.result2).toBe('VALID DATA');

      const logs = await Effect.runPromise(Ref.get(logRef));
      const warnLogs = logs.filter((log) => log.level === 'warn');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0].message).toBe('Invalid data detected');
    });

    it('should capture context in error scenarios', async () => {
      const appLayer = Layer.provide(DataServiceLive, testLoggingLayer);

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        return yield* dataService.fetchData('error');
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(appLayer), Effect.catchAll(() => Effect.void))
      );

      const logs = await Effect.runPromise(Ref.get(logRef));
      const errorLog = logs.find((log) => log.level === 'error');

      expect(errorLog).toBeDefined();
      expect(errorLog?.context).toHaveProperty('id', 'error');
      expect(errorLog?.context).toHaveProperty('reason', 'Not found');
    });
  });

  describe('Console-based LoggingService (Production Implementation)', () => {
    let consoleSpy: {
      log: ReturnType<typeof vi.spyOn>;
      warn: ReturnType<typeof vi.spyOn>;
      error: ReturnType<typeof vi.spyOn>;
    };

    beforeEach(() => {
      consoleSpy = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      };
    });

    it('should use console for logging in production layer', async () => {
      const consoleLoggingLayer = Layer.succeed(LoggingService, {
        debug: (message: string, context?: Record<string, unknown>) =>
          Effect.sync(() => {
            if (context) {
              console.log(`[DEBUG] ${message}`, context);
            } else {
              console.log(`[DEBUG] ${message}`);
            }
          }),

        info: (message: string, context?: Record<string, unknown>) =>
          Effect.sync(() => {
            if (context) {
              console.log(`[INFO] ${message}`, context);
            } else {
              console.log(`[INFO] ${message}`);
            }
          }),

        warn: (message: string, context?: Record<string, unknown>) =>
          Effect.sync(() => {
            if (context) {
              console.warn(`[WARN] ${message}`, context);
            } else {
              console.warn(`[WARN] ${message}`);
            }
          }),

        error: (message: string, context?: Record<string, unknown>) =>
          Effect.sync(() => {
            if (context) {
              console.error(`[ERROR] ${message}`, context);
            } else {
              console.error(`[ERROR] ${message}`);
            }
          }),
      });

      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.debug('Debug test');
        yield* logging.info('Info test', { data: 'value' });
        yield* logging.warn('Warn test');
        yield* logging.error('Error test', { code: 500 });
      });

      await Effect.runPromise(program.pipe(Effect.provide(consoleLoggingLayer)));

      expect(consoleSpy.log).toHaveBeenCalledWith('[DEBUG] Debug test');
      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] Info test', { data: 'value' });
      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] Warn test');
      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error test', { code: 500 });
    });
  });

  describe('Advanced Integration Scenarios', () => {
    it('should support nested Effect.gen blocks with logging', async () => {
      const appLayer = Layer.provide(DataServiceLive, testLoggingLayer);

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        const logging = yield* LoggingService;

        yield* logging.info('Starting batch operation');

        const results = yield* Effect.all([
          dataService.fetchData('item-1'),
          dataService.fetchData('item-2'),
          dataService.fetchData('item-3'),
        ]);

        yield* logging.info('Batch operation complete', { count: results.length });

        return results;
      });

      const results = await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      expect(results).toHaveLength(3);

      const logs = await Effect.runPromise(Ref.get(logRef));
      expect(logs.some((log) => log.message === 'Starting batch operation')).toBe(true);
      expect(logs.some((log) => log.message === 'Batch operation complete')).toBe(true);
    });

    it('should support concurrent operations with shared logging', async () => {
      const appLayer = Layer.mergeAll(
        Layer.provide(DataServiceLive, testLoggingLayer),
        Layer.provide(ProcessorServiceLive, testLoggingLayer)
      );

      const program = Effect.gen(function* () {
        const dataService = yield* DataService;
        const processorService = yield* ProcessorService;

        // Run operations concurrently
        const results = yield* Effect.all(
          [
            dataService.fetchData('concurrent-1'),
            dataService.fetchData('concurrent-2'),
            processorService.process('data-concurrent'),
          ],
          { concurrency: 'unbounded' }
        );

        return results;
      });

      await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));

      // All operations should have logged
      const fetchLogs = logs.filter((log) => log.message.includes('Fetching data'));
      const processLogs = logs.filter((log) => log.message.includes('Processing data'));

      expect(fetchLogs.length).toBeGreaterThanOrEqual(2);
      expect(processLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter logs by level', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.debug('Debug 1');
        yield* logging.info('Info 1');
        yield* logging.debug('Debug 2');
        yield* logging.warn('Warn 1');
        yield* logging.error('Error 1');
        yield* logging.info('Info 2');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));

      const debugLogs = logs.filter((log) => log.level === 'debug');
      const infoLogs = logs.filter((log) => log.level === 'info');
      const warnLogs = logs.filter((log) => log.level === 'warn');
      const errorLogs = logs.filter((log) => log.level === 'error');

      expect(debugLogs).toHaveLength(2);
      expect(infoLogs).toHaveLength(2);
      expect(warnLogs).toHaveLength(1);
      expect(errorLogs).toHaveLength(1);
    });

    it('should preserve log timestamps in order', async () => {
      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        yield* logging.info('First');
        yield* Effect.sleep('10 millis');
        yield* logging.info('Second');
        yield* Effect.sleep('10 millis');
        yield* logging.info('Third');
      });

      await Effect.runPromise(program.pipe(Effect.provide(testLoggingLayer)));

      const logs = await Effect.runPromise(Ref.get(logRef));

      expect(logs).toHaveLength(3);
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(logs[1].timestamp.getTime());
      expect(logs[1].timestamp.getTime()).toBeLessThanOrEqual(logs[2].timestamp.getTime());
    });
  });

  describe('Real-world Pipeline Simulation', () => {
    it('should log a complete bookmark processing pipeline', async () => {
      const appLayer = Layer.mergeAll(
        Layer.provide(DataServiceLive, testLoggingLayer),
        Layer.provide(ProcessorServiceLive, testLoggingLayer)
      );

      const program = Effect.gen(function* () {
        const logging = yield* LoggingService;
        const dataService = yield* DataService;
        const processorService = yield* ProcessorService;

        // Simulate bookmark processing pipeline
        yield* logging.info('Starting bookmark processing pipeline');

        // Fetch bookmark data
        const bookmarkData = yield* dataService.fetchData('bookmark-123');
        yield* logging.debug('Bookmark data retrieved', {
          bookmarkId: 'bookmark-123',
          dataSize: bookmarkData.length
        });

        // Process the bookmark
        const processedData = yield* processorService.process(bookmarkData);
        yield* logging.debug('Bookmark processing complete');

        // Save the processed result
        yield* dataService.saveData('bookmark-123', processedData);

        yield* logging.info('Pipeline complete', { bookmarkId: 'bookmark-123' });

        return processedData;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(appLayer)));

      expect(result).toBe('DATA-BOOKMARK-123');

      const logs = await Effect.runPromise(Ref.get(logRef));

      // Verify pipeline stages are logged
      expect(logs[0].message).toBe('Starting bookmark processing pipeline');
      expect(logs.some((log) => log.message === 'Fetching data')).toBe(true);
      expect(logs.some((log) => log.message === 'Bookmark data retrieved')).toBe(true);
      expect(logs.some((log) => log.message === 'Processing data')).toBe(true);
      expect(logs.some((log) => log.message === 'Bookmark processing complete')).toBe(true);
      expect(logs.some((log) => log.message === 'Saving data')).toBe(true);
      expect(logs[logs.length - 1].message).toBe('Pipeline complete');
    });
  });
});
