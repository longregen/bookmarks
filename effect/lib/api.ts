import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { getPlatformAdapter } from '../../src/lib/platform';
import type { ApiSettings as PlatformApiSettings } from '../../src/lib/platform';
import { config } from '../../src/lib/config-registry';
import { getErrorMessage } from '../../src/lib/errors';
import { createDebugLog, debugOnly } from '../../src/lib/debug';
import { makeLayer, makeEffectLayer } from './effect-utils';

const debugLog = createDebugLog('Embeddings API');

// ============================================================================
// Types
// ============================================================================

export interface QAPair {
  question: string;
  answer: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

interface EmbeddingData {
  embedding: number[];
  index: number;
  object: string;
}

interface EmbeddingsResponse {
  data: EmbeddingData[];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ApiSettings {
  apiKey: string;
  apiBaseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

// ============================================================================
// Errors
// ============================================================================

export class ApiError extends Data.TaggedError('ApiError')<{
  readonly endpoint: string;
  readonly status: number;
  readonly statusText: string;
  readonly message: string;
}> {}

export class ApiConfigError extends Data.TaggedError('ApiConfigError')<{
  readonly message: string;
}> {}

export class ParseError extends Data.TaggedError('ParseError')<{
  readonly message: string;
  readonly content?: string;
}> {}

export class EmptyResponseError extends Data.TaggedError('EmptyResponseError')<{
  readonly message: string;
}> {}

// ============================================================================
// Services
// ============================================================================

export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    getApiSettings(): Effect.Effect<ApiSettings, ApiConfigError>;
    getContentMaxChars(): Effect.Effect<number, never>;
    getChatTemperature(): Effect.Effect<number, never>;
    useChatTemperature(): Effect.Effect<boolean, never>;
    getQASystemPrompt(): Effect.Effect<string, never>;
  }
>() {}

export class ApiService extends Context.Tag('ApiService')<
  ApiService,
  {
    makeRequest<T>(
      endpoint: string,
      body: object
    ): Effect.Effect<T, ApiError | ApiConfigError | ParseError>;

    generateQAPairs(
      markdownContent: string
    ): Effect.Effect<QAPair[], ApiError | ApiConfigError | ParseError | EmptyResponseError>;

    generateEmbeddings(
      texts: string[]
    ): Effect.Effect<number[][], ApiError | ApiConfigError | ParseError>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

export const ConfigServiceLive = makeLayer(ConfigService, {
  getApiSettings: () =>
    Effect.tryPromise({
      try: async () => {
        const settings = await getPlatformAdapter().getSettings();
        return {
          apiKey: settings.apiKey,
          apiBaseUrl: settings.apiBaseUrl,
          chatModel: settings.chatModel,
          embeddingModel: settings.embeddingModel,
        };
      },
      catch: (error) =>
        new ApiConfigError({
          message: `Failed to load API settings: ${getErrorMessage(error)}`,
        }),
    }),

  getContentMaxChars: () =>
    Effect.sync(() => config.API_CONTENT_MAX_CHARS as number),

  getChatTemperature: () =>
    Effect.sync(() => config.API_CHAT_TEMPERATURE as number),

  useChatTemperature: () =>
    Effect.sync(() => config.API_CHAT_USE_TEMPERATURE as boolean),

  getQASystemPrompt: () =>
    Effect.sync(() => config.QA_SYSTEM_PROMPT as string),
});

export const ApiServiceBase = makeEffectLayer(
  ApiService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;

    return {
      makeRequest: <T>(endpoint: string, body: object) =>
        Effect.gen(function* () {
          const settings = yield* configService.getApiSettings();

          if (!settings.apiKey) {
            return yield* Effect.fail(
              new ApiConfigError({
                message:
                  'API key not configured. Please set your API key in the extension options.',
              })
            );
          }

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${settings.apiBaseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${settings.apiKey}`,
                },
                body: JSON.stringify(body),
              }),
            catch: (error) =>
              new ApiError({
                endpoint,
                status: 0,
                statusText: 'Network Error',
                message: getErrorMessage(error),
              }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.promise(() => response.text());
            return yield* Effect.fail(
              new ApiError({
                endpoint,
                status: response.status,
                statusText: response.statusText,
                message: `API error: ${response.status} - ${errorText}`,
              })
            );
          }

          return yield* Effect.tryPromise({
            try: () => response.json() as Promise<T>,
            catch: (error) =>
              new ParseError({
                message: `Failed to parse API response: ${getErrorMessage(error)}`,
              }),
          });
        }),

      generateQAPairs: (markdownContent: string) =>
        Effect.gen(function* () {
          const settings = yield* configService.getApiSettings();
          const maxChars = yield* configService.getContentMaxChars();
          const temperature = yield* configService.getChatTemperature();
          const useTemperature = yield* configService.useChatTemperature();
          const systemPrompt = yield* configService.getQASystemPrompt();

          const truncatedContent = markdownContent.slice(0, maxChars);

          const requestBody = {
            model: settings.chatModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: truncatedContent },
            ],
            response_format: { type: 'json_object' },
            ...(useTemperature && { temperature }),
          };

          const api = yield* ApiService;
          const data = yield* api.makeRequest<ChatCompletionResponse>(
            '/chat/completions',
            requestBody
          );

          const content = data.choices.at(0)?.message.content;
          if (content === undefined) {
            return yield* Effect.fail(
              new EmptyResponseError({
                message: 'Empty response from chat API',
              })
            );
          }

          const parsed = yield* Effect.try({
            try: () => JSON.parse(content) as { pairs?: QAPair[] },
            catch: (error) =>
              new ParseError({
                message: `Failed to parse Q&A pairs from API response: ${getErrorMessage(error)}`,
                content,
              }),
          });

          return parsed.pairs ?? [];
        }),

      generateEmbeddings: (texts: string[]) =>
        Effect.gen(function* () {
          const settings = yield* configService.getApiSettings();

          yield* Effect.sync(() => {
            debugLog('Starting embedding generation', {
              inputCount: texts.length,
              inputLengths: texts.map((t) => t.length),
              model: settings.embeddingModel,
              apiBaseUrl: settings.apiBaseUrl,
            });
          });

          const api = yield* ApiService;
          const data = yield* api
            .makeRequest<EmbeddingsResponse>('/embeddings', {
              model: settings.embeddingModel,
              input: texts,
            })
            .pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  debugLog('API error response', error);
                })
              )
            );

          yield* Effect.sync(() => {
            debugLog('Raw API response', {
              dataLength: data.data.length,
              model: data.model,
              usage: data.usage,
            });
          });

          const sorted = data.data.sort((a, b) => a.index - b.index);
          const embeddings = sorted.map((item) => item.embedding);

          yield* Effect.sync(() => {
            debugOnly(() => {
              debugLog('Extracted embeddings', {
                count: embeddings.length,
                dimensions: embeddings.map((e) => e.length),
                allSameDimension:
                  embeddings.length > 0 &&
                  embeddings.every((e) => e.length === embeddings[0].length),
                firstEmbeddingSample:
                  embeddings.length > 0 ? embeddings[0].slice(0, 5) : [],
              });

              embeddings.forEach((embedding, index) => {
                if (embedding.length === 0) {
                  console.error(
                    `[Embeddings API] Embedding at index ${index} is empty`
                  );
                }
              });
            });
          });

          return embeddings;
        }),
    };
  })
);

export const ApiServiceLive = ApiServiceBase.pipe(Layer.provide(ConfigServiceLive));

// ============================================================================
// Main Layer
// ============================================================================

export const ApiLayerLive = Layer.mergeAll(ConfigServiceLive, ApiServiceLive);

// ============================================================================
// Convenience Functions (Maintain Original API)
// ============================================================================

/**
 * Make a generic API request to an OpenAI-compatible endpoint.
 *
 * @deprecated Use ApiService.makeRequest() with Effect.provide() instead.
 * This function is provided for backward compatibility.
 */
export function makeApiRequest<T>(
  endpoint: string,
  body: object,
  settings: ApiSettings
): Effect.Effect<T, ApiError | ParseError> {
  return Effect.gen(function* () {
    if (!settings.apiKey) {
      return yield* Effect.fail(
        new ApiError({
          endpoint,
          status: 0,
          statusText: 'Configuration Error',
          message:
            'API key not configured. Please set your API key in the extension options.',
        })
      );
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${settings.apiBaseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify(body),
        }),
      catch: (error) =>
        new ApiError({
          endpoint,
          status: 0,
          statusText: 'Network Error',
          message: getErrorMessage(error),
        }),
    });

    if (!response.ok) {
      const errorText = yield* Effect.promise(() => response.text());
      return yield* Effect.fail(
        new ApiError({
          endpoint,
          status: response.status,
          statusText: response.statusText,
          message: `API error: ${response.status} - ${errorText}`,
        })
      );
    }

    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<T>,
      catch: (error) =>
        new ParseError({
          message: `Failed to parse API response: ${getErrorMessage(error)}`,
        }),
    });
  });
}

/**
 * Generate Q&A pairs from markdown content using the chat API.
 *
 * Requires: ConfigService, ApiService
 */
export function generateQAPairs(
  markdownContent: string
): Effect.Effect<
  QAPair[],
  ApiError | ApiConfigError | ParseError | EmptyResponseError,
  ApiService
> {
  return Effect.gen(function* () {
    const api = yield* ApiService;
    return yield* api.generateQAPairs(markdownContent);
  });
}

/**
 * Generate embeddings for multiple texts using the embeddings API.
 *
 * Requires: ConfigService, ApiService
 */
export function generateEmbeddings(
  texts: string[]
): Effect.Effect<number[][], ApiError | ApiConfigError | ParseError, ApiService> {
  return Effect.gen(function* () {
    const api = yield* ApiService;
    return yield* api.generateEmbeddings(texts);
  });
}
