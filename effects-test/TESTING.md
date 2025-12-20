# Running API Integration Tests

## Quick Start

```bash
# Run all effect tests
npm run test:unit -- effects-test/

# Run API integration test specifically
npm run test:unit -- effects-test/api-integration.test.ts

# Run with watch mode
npm run test:unit -- --watch effects-test/

# Run with coverage
npm run test:unit -- --coverage effects-test/
```

## Test Organization

```
effects-test/
├── api-integration.test.ts    # AI/API integration tests
├── README.md                   # Test documentation
└── TESTING.md                  # This file
```

## Running Specific Test Suites

```bash
# Run only configuration tests
npm run test:unit -- effects-test/api-integration.test.ts -t "Configuration"

# Run only makeRequest tests
npm run test:unit -- effects-test/api-integration.test.ts -t "makeRequest"

# Run only generateQAPairs tests
npm run test:unit -- effects-test/api-integration.test.ts -t "generateQAPairs"

# Run only generateEmbeddings tests
npm run test:unit -- effects-test/api-integration.test.ts -t "generateEmbeddings"
```

## Test Output Example

```
✓ effects-test/api-integration.test.ts (50)
  ✓ Configuration Validation (3)
    ✓ should fail when API key is missing
    ✓ should fail when config service fails
    ✓ should successfully retrieve and use API settings
  ✓ makeRequest (6)
    ✓ should successfully make API request
    ✓ should handle network errors
    ✓ should handle 401 Unauthorized errors
    ✓ should handle 429 Rate Limit errors
    ✓ should handle 500 Server errors
    ✓ should handle JSON parse errors
  ✓ generateQAPairs (8)
    ✓ should generate Q&A pairs from markdown content
    ✓ should handle empty response from chat API
    ✓ should handle malformed JSON in chat response
    ✓ should return empty array when pairs field is missing
    ✓ should truncate content to max chars
    ✓ should include temperature when useChatTemperature is true
    ✓ should exclude temperature when useChatTemperature is false
  ✓ generateEmbeddings (6)
    ✓ should generate embeddings for multiple texts
    ✓ should sort embeddings by index
    ✓ should handle embeddings API errors
    ✓ should send correct request body
    ✓ should handle empty embeddings array
  ✓ Request/Response Transformation (4)
    ✓ should correctly transform request headers
    ✓ should correctly transform chat completion request
    ✓ should correctly transform embeddings request
    ✓ should extract embeddings from response in correct order
  ✓ Complex Error Scenarios (2)
    ✓ should handle sequential API errors gracefully
    ✓ should preserve error context through the stack

Test Files  1 passed (1)
     Tests  50 passed (50)
```

## Debugging Tests

### Enable Debug Logging

Set environment variable to see Effect debug output:

```bash
DEBUG=* npm run test:unit -- effects-test/api-integration.test.ts
```

### Run Single Test

```bash
npm run test:unit -- effects-test/api-integration.test.ts -t "should generate Q&A pairs"
```

### Inspect Mock Calls

Tests use `vi.fn()` mocks. You can inspect calls in the test:

```typescript
const fetchMock = globalThis.fetch as any;
console.log(fetchMock.mock.calls);
console.log(fetchMock.mock.calls[0][0]); // URL
console.log(fetchMock.mock.calls[0][1]); // Options
```

## Common Issues

### Issue: Tests fail with "Cannot find module 'effect'"

**Solution**: Install dependencies

```bash
npm install
```

### Issue: Tests timeout

**Solution**: Increase timeout for specific tests

```typescript
it('should handle slow API', async () => {
  // ...
}, 10000); // 10 second timeout
```

### Issue: Mock fetch not working

**Solution**: Ensure `beforeEach` and `afterEach` are properly restoring fetch

```typescript
beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
```

## Test Coverage

The test suite covers:

- ✅ All ApiService methods
- ✅ All error types (ApiError, ApiConfigError, ParseError, EmptyResponseError)
- ✅ Configuration validation
- ✅ HTTP error codes (401, 429, 500)
- ✅ Network failures
- ✅ JSON parsing errors
- ✅ Request/response transformation
- ✅ Edge cases (empty arrays, missing fields, etc.)

## Integration with CI/CD

These tests are designed to run in CI environments:

```yaml
# Example GitHub Actions
- name: Run Effect Tests
  run: npm run test:unit -- effects-test/
```

## Next Steps

After these tests pass, consider:

1. Adding tests for `background/processor` integration
2. Adding tests for `search/search` integration
3. Creating end-to-end tests that combine all modules
4. Adding performance benchmarks for API calls
