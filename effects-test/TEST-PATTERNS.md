# Effect.ts Testing Patterns

Reference guide for common testing patterns used in Effect.ts integration tests.

## Pattern 1: Basic Service Test with Mock Layer

```typescript
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { MyService } from '../effect/services/my-service';

const createMockLayer = () =>
  Layer.succeed(MyService, {
    doSomething: (input: string) => Effect.succeed(`processed: ${input}`)
  });

it('should process input', async () => {
  const program = Effect.gen(function* () {
    const service = yield* MyService;
    return yield* service.doSomething('test');
  });

  const result = await Effect.runPromise(
    Effect.provide(program, createMockLayer())
  );

  expect(result).toBe('processed: test');
});
```

## Pattern 2: Testing Error Cases with Either

```typescript
it('should handle errors gracefully', async () => {
  const mockLayer = Layer.succeed(MyService, {
    doSomething: () => Effect.fail(new MyError({ message: 'Failed' }))
  });

  const program = Effect.gen(function* () {
    const service = yield* MyService;
    return yield* service.doSomething('test');
  });

  const result = await Effect.runPromise(
    Effect.provide(program, mockLayer).pipe(Effect.either)
  );

  expect(result._tag).toBe('Left');
  if (result._tag === 'Left') {
    expect(result.left).toBeInstanceOf(MyError);
    expect(result.left.message).toBe('Failed');
  }
});
```

## Pattern 3: Layer Composition (Multiple Dependencies)

```typescript
import { ServiceA } from '../effect/services/service-a';
import { ServiceB } from '../effect/services/service-b';
import { ServiceC, ServiceCLive } from '../effect/services/service-c';

it('should compose multiple services', async () => {
  const mockServiceA = Layer.succeed(ServiceA, {
    getData: () => Effect.succeed('data-a')
  });

  const mockServiceB = Layer.succeed(ServiceB, {
    transform: (data: string) => Effect.succeed(data.toUpperCase())
  });

  // ServiceC depends on ServiceA and ServiceB
  const testLayer = Layer.mergeAll(
    mockServiceA,
    mockServiceB,
    Layer.provide(ServiceCLive, Layer.mergeAll(mockServiceA, mockServiceB))
  );

  const program = Effect.gen(function* () {
    const serviceC = yield* ServiceC;
    return yield* serviceC.process();
  });

  const result = await Effect.runPromise(
    Effect.provide(program, testLayer)
  );

  expect(result).toBe('DATA-A');
});
```

## Pattern 4: Mocking External APIs (fetch)

```typescript
beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

it('should call external API', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ result: 'success' })
  });

  const program = Effect.gen(function* () {
    const api = yield* ApiService;
    return yield* api.makeRequest('/endpoint', { param: 'value' });
  });

  const result = await Effect.runPromise(
    Effect.provide(program, testLayer)
  );

  expect(result).toEqual({ result: 'success' });
  expect(globalThis.fetch).toHaveBeenCalledWith(
    'https://api.example.com/endpoint',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json'
      })
    })
  );
});
```

## Pattern 5: Testing Async Operations

```typescript
it('should handle async operations', async () => {
  let counter = 0;

  const mockLayer = Layer.succeed(MyService, {
    processAsync: () => Effect.promise(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      counter++;
      return counter;
    })
  });

  const program = Effect.gen(function* () {
    const service = yield* MyService;
    const result1 = yield* service.processAsync();
    const result2 = yield* service.processAsync();
    return [result1, result2];
  });

  const result = await Effect.runPromise(
    Effect.provide(program, mockLayer)
  );

  expect(result).toEqual([1, 2]);
});
```

## Pattern 6: Testing with Configuration

```typescript
import { ConfigService } from '../effect/services/config';

const createMockConfig = (overrides = {}) =>
  Layer.succeed(ConfigService, {
    get: <T>(key: string) => Effect.succeed(
      overrides[key] ?? defaultValues[key]
    )
  });

it('should use configuration', async () => {
  const testConfig = createMockConfig({
    apiKey: 'test-key-123',
    maxRetries: 3
  });

  const testLayer = Layer.provide(MyServiceLive, testConfig);

  const program = Effect.gen(function* () {
    const service = yield* MyService;
    return yield* service.doWork();
  });

  const result = await Effect.runPromise(
    Effect.provide(program, testLayer)
  );

  expect(result).toBeDefined();
});
```

## Pattern 7: Testing Error Recovery

```typescript
it('should retry on failure', async () => {
  let attempts = 0;

  const mockLayer = Layer.succeed(MyService, {
    unstableOperation: () => Effect.gen(function* () {
      attempts++;
      if (attempts < 3) {
        return yield* Effect.fail(new TransientError({ message: 'Try again' }));
      }
      return yield* Effect.succeed('success');
    })
  });

  const program = Effect.gen(function* () {
    const service = yield* MyService;
    return yield* service.unstableOperation().pipe(
      Effect.retry({ times: 3 })
    );
  });

  const result = await Effect.runPromise(
    Effect.provide(program, mockLayer)
  );

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

## Pattern 8: Testing Parallel Operations

```typescript
it('should handle parallel operations', async () => {
  const mockLayer = Layer.succeed(MyService, {
    fetchItem: (id: number) => Effect.succeed({ id, data: `item-${id}` })
  });

  const program = Effect.gen(function* () {
    const service = yield* MyService;

    // Run operations in parallel
    const results = yield* Effect.all([
      service.fetchItem(1),
      service.fetchItem(2),
      service.fetchItem(3)
    ], { concurrency: 'unbounded' });

    return results;
  });

  const result = await Effect.runPromise(
    Effect.provide(program, mockLayer)
  );

  expect(result).toEqual([
    { id: 1, data: 'item-1' },
    { id: 2, data: 'item-2' },
    { id: 3, data: 'item-3' }
  ]);
});
```

## Pattern 9: Testing with Ref for State

```typescript
import * as Ref from 'effect/Ref';

it('should maintain state across operations', async () => {
  const program = Effect.gen(function* () {
    const counter = yield* Ref.make(0);

    yield* Ref.update(counter, n => n + 1);
    yield* Ref.update(counter, n => n + 2);
    yield* Ref.update(counter, n => n + 3);

    return yield* Ref.get(counter);
  });

  const result = await Effect.runPromise(program);
  expect(result).toBe(6);
});
```

## Pattern 10: Testing with Context Passing

```typescript
it('should pass context through layers', async () => {
  const calls: string[] = [];

  const serviceA = Layer.succeed(ServiceA, {
    doWork: () => Effect.sync(() => {
      calls.push('service-a');
      return 'a-result';
    })
  });

  const serviceB = Layer.effect(
    ServiceB,
    Effect.gen(function* () {
      const a = yield* ServiceA;

      return {
        doWork: () => Effect.gen(function* () {
          calls.push('service-b-start');
          const aResult = yield* a.doWork();
          calls.push('service-b-end');
          return `b-${aResult}`;
        })
      };
    })
  ).pipe(Layer.provide(serviceA));

  const program = Effect.gen(function* () {
    const b = yield* ServiceB;
    return yield* b.doWork();
  });

  const result = await Effect.runPromise(
    Effect.provide(program, serviceB)
  );

  expect(result).toBe('b-a-result');
  expect(calls).toEqual(['service-b-start', 'service-a', 'service-b-end']);
});
```

## Pattern 11: Testing Tagged Errors

```typescript
import * as Data from 'effect/Data';

class NetworkError extends Data.TaggedError('NetworkError')<{
  message: string;
  retryable: boolean;
}> {}

class ValidationError extends Data.TaggedError('ValidationError')<{
  field: string;
  reason: string;
}> {}

it('should differentiate error types', async () => {
  const mockLayer = Layer.succeed(MyService, {
    riskyOperation: (input: string) => {
      if (input === '') {
        return Effect.fail(new ValidationError({
          field: 'input',
          reason: 'Cannot be empty'
        }));
      }
      if (input === 'network-fail') {
        return Effect.fail(new NetworkError({
          message: 'Connection lost',
          retryable: true
        }));
      }
      return Effect.succeed('ok');
    }
  });

  const program = Effect.gen(function* () {
    const service = yield* MyService;
    return yield* service.riskyOperation('');
  });

  const result = await Effect.runPromise(
    Effect.provide(program, mockLayer).pipe(Effect.either)
  );

  expect(result._tag).toBe('Left');
  if (result._tag === 'Left') {
    expect(result.left).toBeInstanceOf(ValidationError);
    if (result.left._tag === 'ValidationError') {
      expect(result.left.field).toBe('input');
    }
  }
});
```

## Pattern 12: Testing Request/Response Transformation

```typescript
it('should transform request and response', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' }
      ]
    })
  });

  const program = Effect.gen(function* () {
    const api = yield* ApiService;
    return yield* api.makeRequest('/items', {
      filter: 'active',
      sort: 'name'
    });
  });

  const result = await Effect.runPromise(
    Effect.provide(program, testLayer)
  );

  // Verify request was transformed correctly
  const fetchCall = (globalThis.fetch as any).mock.calls[0];
  const requestBody = JSON.parse(fetchCall[1].body);
  expect(requestBody).toEqual({
    filter: 'active',
    sort: 'name'
  });

  // Verify response was received correctly
  expect(result.data).toHaveLength(2);
  expect(result.data[0].name).toBe('Item 1');
});
```

## Best Practices

1. **Always clean up mocks** in `afterEach`
2. **Use `Effect.either`** to test error cases
3. **Compose layers properly** to avoid dependency issues
4. **Test both success and error paths**
5. **Use meaningful test descriptions**
6. **Keep test data realistic** but minimal
7. **Mock at the appropriate level** (service vs. API)
8. **Test edge cases** (empty arrays, null values, etc.)
9. **Verify side effects** (API calls, state changes)
10. **Use TypeScript types** for better test safety

## Common Pitfalls

❌ **Don't**: Forget to restore mocks
```typescript
// Missing cleanup
it('test', async () => {
  globalThis.fetch = vi.fn();
  // ... test code
  // ❌ No cleanup!
});
```

✅ **Do**: Always clean up in afterEach
```typescript
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
```

❌ **Don't**: Mix layer dependencies incorrectly
```typescript
// Wrong - ServiceB won't have access to ServiceA
const testLayer = Layer.mergeAll(
  mockServiceA,
  ServiceBLive  // ❌ Missing dependency
);
```

✅ **Do**: Provide dependencies explicitly
```typescript
const testLayer = Layer.mergeAll(
  mockServiceA,
  Layer.provide(ServiceBLive, mockServiceA)  // ✅ Correct
);
```

❌ **Don't**: Test implementation details
```typescript
it('should call internal method', () => {
  // ❌ Testing internals
  expect(service._internalMethod).toHaveBeenCalled();
});
```

✅ **Do**: Test public behavior
```typescript
it('should return processed result', () => {
  // ✅ Testing behavior
  expect(result).toBe('processed');
});
```
