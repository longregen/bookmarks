# Effect.ts Integration Tests

This directory contains integration tests for the Effect.ts refactored codebase.

## Configuration Management Integration Test

**File:** `config-integration.test.ts`

### Overview

This test validates the "Configuration Management" cooperation pattern in the Effect.ts refactored codebase, ensuring proper configuration flow between modules.

### Modules Tested

- `services/config-service` - Simple ConfigService interface
- `lib/config-registry` - Full ConfigService implementation with validation
- `lib/api` - Consumer using configuration for API settings
- `lib/similarity` - Consumer using similarity thresholds
- `background/queue` - Consumer using queue configuration
- `search/search` - Consumer using search configuration

### Test Coverage

#### 1. ConfigService Layer Provision (3 tests)
- ✅ Provision ConfigService layer with mock storage
- ✅ Load initial configuration from storage
- ✅ Handle missing storage data gracefully

#### 2. Configuration Value Retrieval (4 tests)
- ✅ Retrieve default values for all config keys
- ✅ Retrieve overridden values when present
- ✅ Fail with ConfigNotFoundError for unknown keys
- ✅ Support type-safe retrieval (number, string, boolean)

#### 3. Configuration Updates (6 tests)
- ✅ Update configuration values
- ✅ Persist updates to storage
- ✅ Propagate updates to all consumers
- ✅ Reset individual values
- ✅ Reset all values
- ✅ Track modification status

#### 4. Validation Errors (5 tests)
- ✅ Validate type constraints
- ✅ Validate minimum constraints
- ✅ Validate maximum constraints
- ✅ Validate unknown keys
- ✅ Accept valid values within constraints

#### 5. Storage Error Handling (3 tests)
- ✅ Handle storage load failures
- ✅ Handle storage save failures
- ✅ Provide default values when load fails

#### 6. Consumer Integration (3 tests)
- ✅ Integrate with similarity module
- ✅ Support concurrent access from multiple consumers
- ✅ Maintain consistency across updates and reads

#### 7. Advanced Features (3 tests)
- ✅ Support getAllEntries with metadata
- ✅ Support searchEntries
- ✅ Support getModifiedCount

#### 8. Config Proxy (3 tests)
- ✅ Create a synchronous config proxy
- ✅ Reflect updates through proxy
- ✅ Handle errors gracefully in proxy

### Running the Tests

```bash
# Run all Effect.ts integration tests
npm run test:unit -- effects-test/

# Run only the configuration integration test
npm run test:unit -- effects-test/config-integration.test.ts

# Run with verbose output
npx vitest run effects-test/config-integration.test.ts --reporter=verbose

# Run in watch mode
npx vitest watch effects-test/config-integration.test.ts
```

### Key Features

1. **Mock Storage Layer**: Tests use an in-memory mock storage service for isolation, avoiding database dependencies
2. **Typed Errors**: All error scenarios are tested with proper Effect error types (ConfigNotFoundError, ConfigValidationError, ConfigStorageError)
3. **Layer Composition**: Tests demonstrate proper Effect layer composition and dependency injection
4. **Consumer Integration**: Tests verify configuration propagation to actual consumer modules
5. **Concurrent Access**: Tests verify thread-safe concurrent access patterns

### Test Architecture

```
┌─────────────────────────────────────────┐
│  Mock Storage Service (In-Memory)       │
│  - Isolated from actual database        │
│  - Configurable failure modes           │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  ConfigService Layer                     │
│  - Full implementation from registry    │
│  - Validation logic                     │
│  - State management with Ref            │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Consumer Modules                        │
│  - SimpleConfigService bridge           │
│  - Similarity module integration        │
│  - Multiple concurrent consumers        │
└─────────────────────────────────────────┘
```

### Configuration Flow

1. **Storage Layer** → Loads/saves configuration overrides
2. **ConfigService** → Manages state, validates, merges defaults
3. **Consumers** → Read configuration via Effect-based API
4. **Updates** → Propagate immediately to all consumers

### Error Handling

All errors are properly typed and tested:

- **ConfigNotFoundError**: Unknown configuration key
- **ConfigValidationError**: Type mismatch, out of range, unknown key
- **ConfigStorageError**: Storage operation failures (load/save)

Each error includes structured metadata for debugging.
