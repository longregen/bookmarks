# Config Registry - Effect.ts Refactoring

## Overview

The config-registry module has been refactored to use Effect.ts patterns while maintaining backward compatibility with the original API. This refactor provides better type safety, composability, and dependency injection capabilities.

## File Location

- **Original**: `/home/user/bookmarks/src/lib/config-registry.ts`
- **Refactored**: `/home/user/bookmarks/effect/lib/config-registry.ts`

## Key Changes

### 1. Typed Error Handling

Replaced generic error handling with typed errors using `Data.TaggedError`:

- **ConfigNotFoundError**: When a config key doesn't exist in the registry
- **ConfigValidationError**: When a config value fails type or range validation
- **ConfigStorageError**: When database operations fail (load/save)

```typescript
export class ConfigValidationError extends Data.TaggedError('ConfigValidationError')<{
  readonly key: string;
  readonly reason: string;
  readonly expectedType?: string;
  readonly actualType?: string;
  readonly min?: number;
  readonly max?: number;
  readonly value?: unknown;
}> {}
```

### 2. Service Interface with Context.Tag

Created a `ConfigService` using Effect's `Context.Tag` pattern:

```typescript
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
```

### 3. Storage Abstraction

Introduced a `StorageService` interface to abstract storage operations:

```typescript
export interface StorageService {
  readonly get: <T>(key: string) => Effect.Effect<T | undefined, ConfigStorageError>;
  readonly put: <T>(key: string, value: T) => Effect.Effect<void, ConfigStorageError>;
}
```

This allows for different storage backends (IndexedDB, SQLite, Remote API) without changing the config service implementation.

### 4. State Management with Ref

Used Effect's `Ref` for managing mutable state in a safe, concurrent manner:

```typescript
interface ConfigState {
  overrides: Record<string, number | string | boolean>;
  loaded: boolean;
  cache: Record<string, number | string | boolean>;
}

const stateRef = yield* Ref.make<ConfigState>({
  overrides: {},
  loaded: false,
  cache: buildConfigCache({}),
});
```

### 5. Layer-based Dependency Injection

Provided multiple layers for different usage scenarios:

```typescript
// Generic layer (accepts any StorageService implementation)
export const ConfigServiceLive = (storage: StorageService): Layer.Layer<ConfigService> =>
  Layer.effect(ConfigService, makeConfigService(storage));

// Production layer with Dexie/IndexedDB storage
export const ConfigServiceLiveWithDexie: Layer.Layer<ConfigService> =
  Layer.effect(ConfigService, makeConfigService(makeDexieStorageService()));
```

### 6. Effect.gen Composition

Replaced async/await with `Effect.gen` for better composition and error handling:

```typescript
const getValue = (key: string): Effect.Effect<number | string | boolean, ConfigNotFoundError> =>
  Effect.gen(function* () {
    if (!registryMap.has(key)) {
      return yield* Effect.fail(new ConfigNotFoundError({ key }));
    }

    const state = yield* Ref.get(stateRef);
    return state.cache[key];
  });
```

## Maintained Features

All features from the original implementation are preserved:

1. **Config Registry**: Same 28 configuration entries across 10 categories
2. **Type Safety**: Typed config values via `ConfigValues` interface
3. **Validation**: Type checking and range validation for number configs
4. **Persistence**: Automatic save/load from database
5. **Search**: Search config entries by key or description
6. **Modified Tracking**: Track which configs have been modified from defaults
7. **Backward Compatibility**: `makeConfigProxy` provides the same interface as the original `config` object

## Usage Examples

### Basic Usage with Layer

```typescript
import { ConfigService, ConfigServiceLiveWithDexie } from './effect/lib/config-registry';
import { Effect, Layer } from 'effect';

// Define your program
const program = Effect.gen(function* () {
  const config = yield* ConfigService;

  // Load config from database
  yield* config.loadOverrides();

  // Get a value
  const concurrency = yield* config.getValue('FETCH_CONCURRENCY');

  // Set a value (validates and saves)
  yield* config.setValue('FETCH_CONCURRENCY', 10);

  // Get all entries
  const allEntries = yield* config.getAllEntries();

  return allEntries;
});

// Run with the Dexie storage layer
const result = await Effect.runPromise(
  program.pipe(Effect.provide(ConfigServiceLiveWithDexie))
);
```

### With Custom Storage Backend

```typescript
import { ConfigService, ConfigServiceLive, StorageService } from './effect/lib/config-registry';

// Create a custom storage service (e.g., for testing)
const testStorage: StorageService = {
  get: (key) => Effect.succeed(testData[key]),
  put: (key, value) => Effect.sync(() => { testData[key] = value; }),
};

const testLayer = ConfigServiceLive(testStorage);

// Run program with test layer
const result = await Effect.runPromise(
  program.pipe(Effect.provide(testLayer))
);
```

### Error Handling

```typescript
const program = Effect.gen(function* () {
  const config = yield* ConfigService;

  // Try to get a value, handle errors
  const value = yield* config.getValue('INVALID_KEY').pipe(
    Effect.catchTag('ConfigNotFoundError', (error) => {
      console.log(`Config key not found: ${error.key}`);
      return Effect.succeed(0); // Default value
    })
  );

  // Try to set a value, handle validation errors
  yield* config.setValue('FETCH_CONCURRENCY', 'invalid').pipe(
    Effect.catchTag('ConfigValidationError', (error) => {
      console.log(`Validation failed: ${error.reason}`);
      return Effect.void;
    })
  );
});
```

## Benefits of Effect.ts Refactor

1. **Type Safety**: All errors are typed and must be handled explicitly
2. **Composability**: Effects can be combined using Effect operators
3. **Testability**: Easy to inject test storage without mocking
4. **Resource Safety**: Automatic cleanup via Effect's resource management
5. **Dependency Injection**: Layers provide compile-time verified dependency graph
6. **Storage Flexibility**: Easy to swap storage backends (SQLite, Remote API, etc.)
7. **Concurrent Safety**: Ref ensures safe concurrent access to state
8. **Better Error Messages**: Tagged errors preserve context and details

## Migration Path

The refactored module maintains backward compatibility:

1. **Phase 1**: Use `ConfigServiceLiveWithDexie` layer in new Effect-based code
2. **Phase 2**: Gradually migrate existing code to use the Effect-based API
3. **Phase 3**: Use `makeConfigProxy` to bridge between old and new code if needed

## Files Modified

- Created: `/home/user/bookmarks/effect/lib/config-registry.ts` (712 lines)
- Added Dexie storage implementation using Effect patterns
- Fixed error handling patterns to use `Effect.fail()` properly
- Added proper type annotations using `Context.Tag.Service<>`

## Testing Considerations

The Effect-based implementation makes testing much easier:

```typescript
// Test example
import { ConfigService, ConfigServiceLive } from './effect/lib/config-registry';

const mockStorage = {
  get: () => Effect.succeed({ FETCH_CONCURRENCY: 5 }),
  put: () => Effect.void,
};

const testLayer = ConfigServiceLive(mockStorage);

test('config service', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* ConfigService;
      return yield* config.getValue('FETCH_CONCURRENCY');
    }).pipe(Effect.provide(testLayer))
  );

  expect(result).toBe(5);
});
```
