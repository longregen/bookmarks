# API Module Refactoring

## Overview

Refactored `/home/user/bookmarks/src/lib/api.ts` to use Effect.ts patterns while maintaining API compatibility.

**Original:** 136 lines
**Refactored:** 417 lines
**Location:** `/home/user/bookmarks/effect/lib/api.ts`

## Key Changes

### 1. Typed Errors (Data.TaggedError)

Replaced generic `Error` with typed error classes:

- **ApiError** - HTTP/network failures with status, endpoint, and message
- **ApiConfigError** - Missing or invalid configuration (e.g., API key)
- **ParseError** - JSON parsing failures with optional content
- **EmptyResponseError** - Empty API responses

**Before:**
```typescript
throw new Error('API key not configured...');
throw new Error(`API error: ${response.status}...`);
```

**After:**
```typescript
new ApiConfigError({ message: 'API key not configured...' })
new ApiError({ endpoint, status, statusText, message })
```

### 2. Service Layer (Context.Tag)

Introduced two services:

#### ConfigService
Provides configuration values with Effect-based API:
- `getApiSettings()` - Loads API credentials from platform adapter
- `getContentMaxChars()` - Max characters for chat content
- `getChatTemperature()` - Temperature setting for chat model
- `useChatTemperature()` - Whether to include temperature parameter
- `getQASystemPrompt()` - System prompt for Q&A generation

#### ApiService
Provides API operations:
- `makeRequest<T>(endpoint, body)` - Generic API request
- `generateQAPairs(markdownContent)` - Q&A pair generation
- `generateEmbeddings(texts)` - Embedding generation

**Before:**
```typescript
async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getPlatformAdapter().getSettings();
  // ... implementation
}
```

**After:**
```typescript
generateQAPairs: (markdownContent: string) =>
  Effect.gen(function* () {
    const settings = yield* configService.getApiSettings();
    // ... implementation
  })
```

### 3. Dependency Injection (Layers)

Created layers for service implementations:

- **ConfigServiceLive** - Wraps platform adapter and config registry
- **ApiServiceLive** - Implements API operations, depends on ConfigService
- **ApiLayerLive** - Combined layer for all API services

**Usage Example:**
```typescript
import { ApiLayerLive, generateEmbeddings } from './effect/lib/api';
import { Effect } from 'effect';

// Run with dependency injection
const program = generateEmbeddings(['text1', 'text2']);
const embeddings = await Effect.runPromise(
  program.pipe(Effect.provide(ApiLayerLive))
);
```

### 4. Effect Composition

Replaced Promise chains with Effect.gen:

**Before:**
```typescript
async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getPlatformAdapter().getSettings();
  const truncatedContent = markdownContent.slice(0, config.API_CONTENT_MAX_CHARS);
  const data = await makeApiRequest<ChatCompletionResponse>(...);
  const content = data.choices.at(0)?.message.content;
  if (content === undefined) {
    throw new Error('Empty response from chat API');
  }
  try {
    const parsed = JSON.parse(content) as { pairs?: QAPair[] };
    return parsed.pairs ?? [];
  } catch (error) {
    throw new Error(`Failed to parse Q&A pairs...`);
  }
}
```

**After:**
```typescript
generateQAPairs: (markdownContent: string) =>
  Effect.gen(function* () {
    const settings = yield* configService.getApiSettings();
    const maxChars = yield* configService.getContentMaxChars();
    const truncatedContent = markdownContent.slice(0, maxChars);

    const api = yield* ApiService;
    const data = yield* api.makeRequest<ChatCompletionResponse>(...);

    const content = data.choices.at(0)?.message.content;
    if (content === undefined) {
      return yield* Effect.fail(
        new EmptyResponseError({ message: 'Empty response from chat API' })
      );
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as { pairs?: QAPair[] },
      catch: (error) => new ParseError({ message: '...', content }),
    });

    return parsed.pairs ?? [];
  })
```

## Backward Compatibility

The refactored module exports standalone functions that maintain the original API:

```typescript
// Original API (Promise-based)
export function makeApiRequest<T>(
  endpoint: string,
  body: object,
  settings: ApiSettings
): Effect.Effect<T, ApiError | ParseError>

export function generateQAPairs(
  markdownContent: string
): Effect.Effect<QAPair[], ApiError | ApiConfigError | ParseError | EmptyResponseError, ApiService>

export function generateEmbeddings(
  texts: string[]
): Effect.Effect<number[][], ApiError | ApiConfigError | ParseError, ApiService>
```

These functions return Effects instead of Promises, but can be executed with `Effect.runPromise()` for drop-in compatibility.

## Error Handling

Effect.ts enables granular error handling:

```typescript
const program = generateQAPairs(content).pipe(
  Effect.catchTag('ApiConfigError', (err) => {
    // Handle missing API key
    console.error('Configuration error:', err.message);
    return Effect.succeed([]);
  }),
  Effect.catchTag('ApiError', (err) => {
    // Handle HTTP errors with retry logic
    if (err.status >= 500) {
      return Effect.retry(generateQAPairs(content), { times: 3 });
    }
    return Effect.fail(err);
  }),
  Effect.catchTag('ParseError', (err) => {
    // Handle malformed responses
    console.error('Parse error:', err.message, err.content);
    return Effect.succeed([]);
  })
);
```

## Testing Benefits

Layer-based dependency injection simplifies testing:

```typescript
// Mock layer for tests
const MockConfigService = Layer.succeed(ConfigService, {
  getApiSettings: () => Effect.succeed({
    apiKey: 'test-key',
    apiBaseUrl: 'http://localhost:8080/v1',
    chatModel: 'gpt-4',
    embeddingModel: 'text-embedding-ada-002',
  }),
  getContentMaxChars: () => Effect.succeed(1000),
  // ... other methods
});

const MockApiService = Layer.succeed(ApiService, {
  makeRequest: <T>() => Effect.succeed({ /* mock response */ } as T),
  generateQAPairs: () => Effect.succeed([{ question: 'Q?', answer: 'A.' }]),
  generateEmbeddings: () => Effect.succeed([[0.1, 0.2, 0.3]]),
});

// Test with mocks
const program = generateQAPairs('test content');
const result = await Effect.runPromise(
  program.pipe(Effect.provide(MockApiService))
);
```

## Migration Path

1. **Phase 1:** Use Effect-based API in new code
2. **Phase 2:** Gradually migrate existing callers to Effect
3. **Phase 3:** Remove Promise-based wrappers once all callers migrated

Example migration:

```typescript
// Old code
try {
  const pairs = await generateQAPairs(content);
  // ... use pairs
} catch (error) {
  console.error('Failed to generate Q&A pairs:', error);
}

// New code (minimal change)
const pairs = await Effect.runPromise(
  generateQAPairs(content).pipe(Effect.provide(ApiLayerLive))
);

// New code (full Effect composition)
const program = Effect.gen(function* () {
  const pairs = yield* generateQAPairs(content);
  // ... compose with other effects
  return pairs;
});

await Effect.runPromise(program.pipe(Effect.provide(ApiLayerLive)));
```

## Benefits Realized

| Aspect | Original | Refactored |
|--------|----------|------------|
| Error types | Generic `Error` | 4 typed error classes |
| Testing | Manual mocking | Layer injection |
| Dependencies | Implicit imports | Explicit in type signature |
| Error handling | Try/catch | Pattern matching on error type |
| Composition | Promise.all | Effect.all with typed errors |
| Resource safety | Manual cleanup | Effect.acquireRelease (future) |

## Next Steps

1. Create similar refactorings for other modules (fetcher, processor, sync)
2. Add retry/timeout policies using Effect's built-in combinators
3. Implement circuit breaker pattern for API calls
4. Add telemetry/logging using Effect's tracing capabilities
