import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import {
  ApiService,
  ConfigService,
  ApiServiceLive,
  ApiError,
  ApiConfigError,
  ParseError,
  EmptyResponseError,
  generateQAPairs,
  generateEmbeddings,
  type QAPair,
  type ApiSettings,
} from '../effect/lib/api';

// ============================================================================
// Test Helpers
// ============================================================================

const createMockApiSettings = (overrides?: Partial<ApiSettings>): ApiSettings => ({
  apiKey: 'test-api-key',
  apiBaseUrl: 'https://api.example.com',
  chatModel: 'gpt-4',
  embeddingModel: 'text-embedding-3-small',
  ...overrides,
});

const createMockConfigService = (settings: ApiSettings) =>
  Layer.succeed(ConfigService, {
    getApiSettings: () => Effect.succeed(settings),
    getContentMaxChars: () => Effect.succeed(10000),
    getChatTemperature: () => Effect.succeed(0.7),
    useChatTemperature: () => Effect.succeed(true),
    getQASystemPrompt: () =>
      Effect.succeed(
        'Generate question-answer pairs from the provided content. Return a JSON object with a "pairs" array.'
      ),
  });

const createMockConfigServiceWithError = (error: ApiConfigError) =>
  Layer.succeed(ConfigService, {
    getApiSettings: () => Effect.fail(error),
    getContentMaxChars: () => Effect.succeed(10000),
    getChatTemperature: () => Effect.succeed(0.7),
    useChatTemperature: () => Effect.succeed(true),
    getQASystemPrompt: () => Effect.succeed('Test prompt'),
  });

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

const createMockFetch = (response: Partial<MockFetchResponse>) => {
  const defaultResponse: MockFetchResponse = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '',
    ...response,
  };
  return vi.fn().mockResolvedValue(defaultResponse);
};

// ============================================================================
// Test Suite
// ============================================================================

describe('API Integration Tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration Validation', () => {
    it('should fail when API key is missing', async () => {
      const mockSettings = createMockApiSettings({ apiKey: '' });
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiConfigError);
        expect(result.left.message).toContain('API key not configured');
      }
    });

    it('should fail when config service fails', async () => {
      const configError = new ApiConfigError({
        message: 'Failed to load settings',
      });
      const mockConfig = createMockConfigServiceWithError(configError);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiConfigError);
        expect(result.left.message).toBe('Failed to load settings');
      }
    });

    it('should successfully retrieve and use API settings', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest<{ success: boolean }>('/test', {});
      });

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual({ success: true });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  // ==========================================================================
  // makeRequest Tests
  // ==========================================================================

  describe('makeRequest', () => {
    it('should successfully make API request', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const responseData = { result: 'success', data: [1, 2, 3] };
      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => responseData,
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest<typeof responseData>('/test-endpoint', {
          param: 'value',
        });
      });

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual(responseData);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiError);
        expect(result.left.status).toBe(0);
        expect(result.left.statusText).toBe('Network Error');
        expect(result.left.message).toContain('Network failure');
      }
    });

    it('should handle 401 Unauthorized errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid API key',
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiError);
        expect(result.left.status).toBe(401);
        expect(result.left.statusText).toBe('Unauthorized');
        expect(result.left.message).toContain('Invalid API key');
      }
    });

    it('should handle 429 Rate Limit errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiError);
        expect(result.left.status).toBe(429);
        expect(result.left.message).toContain('Rate limit exceeded');
      }
    });

    it('should handle 500 Server errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error occurred',
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiError);
        expect(result.left.status).toBe(500);
        expect(result.left.statusText).toBe('Internal Server Error');
      }
    });

    it('should handle JSON parse errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test', {});
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ParseError);
        expect(result.left.message).toContain('Failed to parse API response');
      }
    });
  });

  // ==========================================================================
  // generateQAPairs Tests
  // ==========================================================================

  describe('generateQAPairs', () => {
    it('should generate Q&A pairs from markdown content', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const qaPairs: QAPair[] = [
        { question: 'What is this about?', answer: 'It is a test document.' },
        { question: 'How does it work?', answer: 'Through API calls.' },
      ];

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ pairs: qaPairs }),
              },
            },
          ],
        }),
      });

      const markdownContent = '# Test Document\n\nThis is a test.';
      const program = generateQAPairs(markdownContent);

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual(qaPairs);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(markdownContent),
        })
      );
    });

    it('should handle empty response from chat API', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [],
        }),
      });

      const program = generateQAPairs('# Test');

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(EmptyResponseError);
        expect(result.left.message).toContain('Empty response from chat API');
      }
    });

    it('should handle malformed JSON in chat response', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'not valid JSON {',
              },
            },
          ],
        }),
      });

      const program = generateQAPairs('# Test');

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ParseError);
        expect(result.left.message).toContain('Failed to parse Q&A pairs');
      }
    });

    it('should return empty array when pairs field is missing', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ other: 'data' }),
              },
            },
          ],
        }),
      });

      const program = generateQAPairs('# Test');

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual([]);
    });

    it('should truncate content to max chars', async () => {
      const mockSettings = createMockApiSettings();
      const maxChars = 100;
      const mockConfig = Layer.succeed(ConfigService, {
        getApiSettings: () => Effect.succeed(mockSettings),
        getContentMaxChars: () => Effect.succeed(maxChars),
        getChatTemperature: () => Effect.succeed(0.7),
        useChatTemperature: () => Effect.succeed(true),
        getQASystemPrompt: () => Effect.succeed('Test prompt'),
      });
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ pairs: [] }),
              },
            },
          ],
        }),
      });

      const longContent = 'a'.repeat(200);
      const program = generateQAPairs(longContent);

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      const sentContent = requestBody.messages[1].content;

      expect(sentContent.length).toBe(maxChars);
    });

    it('should include temperature when useChatTemperature is true', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ pairs: [] }),
              },
            },
          ],
        }),
      });

      const program = generateQAPairs('# Test');

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody.temperature).toBe(0.7);
    });

    it('should exclude temperature when useChatTemperature is false', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = Layer.succeed(ConfigService, {
        getApiSettings: () => Effect.succeed(mockSettings),
        getContentMaxChars: () => Effect.succeed(10000),
        getChatTemperature: () => Effect.succeed(0.7),
        useChatTemperature: () => Effect.succeed(false),
        getQASystemPrompt: () => Effect.succeed('Test prompt'),
      });
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ pairs: [] }),
              },
            },
          ],
        }),
      });

      const program = generateQAPairs('# Test');

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody.temperature).toBeUndefined();
    });
  });

  // ==========================================================================
  // generateEmbeddings Tests
  // ==========================================================================

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { embedding: embeddings[0], index: 0, object: 'embedding' },
            { embedding: embeddings[1], index: 1, object: 'embedding' },
            { embedding: embeddings[2], index: 2, object: 'embedding' },
          ],
          model: 'text-embedding-3-small',
          usage: {
            prompt_tokens: 30,
            total_tokens: 30,
          },
        }),
      });

      const texts = ['text one', 'text two', 'text three'];
      const program = generateEmbeddings(texts);

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual(embeddings);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/embeddings',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('text one'),
        })
      );
    });

    it('should sort embeddings by index', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      // Return embeddings in wrong order
      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { embedding: embeddings[2], index: 2, object: 'embedding' },
            { embedding: embeddings[0], index: 0, object: 'embedding' },
            { embedding: embeddings[1], index: 1, object: 'embedding' },
          ],
          model: 'text-embedding-3-small',
        }),
      });

      const texts = ['text one', 'text two', 'text three'];
      const program = generateEmbeddings(texts);

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual(embeddings);
    });

    it('should handle embeddings API errors', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded for embeddings',
      });

      const program = generateEmbeddings(['text']);

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(ApiError);
        expect(result.left.status).toBe(429);
      }
    });

    it('should send correct request body', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
          model: 'text-embedding-3-small',
        }),
      });

      const texts = ['test text'];
      const program = generateEmbeddings(texts);

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody).toEqual({
        model: 'text-embedding-3-small',
        input: texts,
      });
    });

    it('should handle empty embeddings array', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          model: 'text-embedding-3-small',
        }),
      });

      const program = generateEmbeddings([]);

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Request/Response Transformation Tests
  // ==========================================================================

  describe('Request/Response Transformation', () => {
    it('should correctly transform request headers', async () => {
      const mockSettings = createMockApiSettings({
        apiKey: 'custom-key-123',
        apiBaseUrl: 'https://custom.api.com',
      });
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/custom', { data: 'test' });
      });

      await Effect.runPromise(Effect.provide(program, testLayer));

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://custom.api.com/custom',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer custom-key-123',
          },
          body: JSON.stringify({ data: 'test' }),
        })
      );
    });

    it('should correctly transform chat completion request', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ pairs: [] }),
              },
            },
          ],
        }),
      });

      const program = generateQAPairs('# Test Content');

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody).toMatchObject({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: expect.stringContaining('question-answer pairs'),
          },
          {
            role: 'user',
            content: '# Test Content',
          },
        ],
        response_format: { type: 'json_object' },
      });
    });

    it('should correctly transform embeddings request', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { embedding: [0.1, 0.2], index: 0, object: 'embedding' },
            { embedding: [0.3, 0.4], index: 1, object: 'embedding' },
          ],
          model: 'text-embedding-3-small',
        }),
      });

      const texts = ['first text', 'second text'];
      const program = generateEmbeddings(texts);

      await Effect.runPromise(Effect.provide(program, testLayer));

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody).toEqual({
        model: 'text-embedding-3-small',
        input: ['first text', 'second text'],
      });
    });

    it('should extract embeddings from response in correct order', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { embedding: [1, 2, 3], index: 2, object: 'embedding' },
            { embedding: [4, 5, 6], index: 0, object: 'embedding' },
            { embedding: [7, 8, 9], index: 1, object: 'embedding' },
          ],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      });

      const program = generateEmbeddings(['a', 'b', 'c']);

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result).toEqual([
        [4, 5, 6], // index 0
        [7, 8, 9], // index 1
        [1, 2, 3], // index 2
      ]);
    });
  });

  // ==========================================================================
  // Complex Error Scenarios
  // ==========================================================================

  describe('Complex Error Scenarios', () => {
    it('should handle sequential API errors gracefully', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: async () => 'Rate limited',
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ pairs: [] }),
        });
      });

      const program1 = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test1', {});
      });

      const result1 = await Effect.runPromise(
        Effect.provide(program1, testLayer).pipe(Effect.either)
      );

      expect(result1._tag).toBe('Left');

      const program2 = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test2', {});
      });

      const result2 = await Effect.runPromise(
        Effect.provide(program2, testLayer).pipe(Effect.either)
      );

      expect(result2._tag).toBe('Right');
    });

    it('should preserve error context through the stack', async () => {
      const mockSettings = createMockApiSettings();
      const mockConfig = createMockConfigService(mockSettings);
      const testLayer = Layer.provide(ApiServiceLive, mockConfig);

      globalThis.fetch = createMockFetch({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Access denied to model',
      });

      const program = Effect.gen(function* () {
        const api = yield* ApiService;
        return yield* api.makeRequest('/test-endpoint', { test: 'data' });
      });

      const result = await Effect.runPromise(
        Effect.provide(program, testLayer).pipe(Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        const error = result.left as ApiError;
        expect(error.endpoint).toBe('/test-endpoint');
        expect(error.status).toBe(403);
        expect(error.statusText).toBe('Forbidden');
        expect(error.message).toContain('Access denied to model');
      }
    });
  });
});
