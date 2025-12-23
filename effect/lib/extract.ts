import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import * as Schedule from 'effect/Schedule';
import * as Duration from 'effect/Duration';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
}

// ============================================================================
// Typed Errors
// ============================================================================

export class ReadabilityParseError extends Data.TaggedError('ReadabilityParseError')<{
  readonly url: string;
  readonly htmlLength: number;
  readonly message: string;
}> {}

export class OffscreenTimeoutError extends Data.TaggedError('OffscreenTimeoutError')<{
  readonly url: string;
  readonly timeoutMs: number;
  readonly message: string;
}> {}

export class OffscreenCommunicationError extends Data.TaggedError('OffscreenCommunicationError')<{
  readonly url: string;
  readonly attempt: number;
  readonly message: string;
}> {}

export class ExtractionError extends Data.TaggedError('ExtractionError')<{
  readonly url: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ExtractError =
  | ReadabilityParseError
  | OffscreenTimeoutError
  | OffscreenCommunicationError
  | ExtractionError;

// ============================================================================
// Services
// ============================================================================

export class TurndownServiceTag extends Context.Tag('TurndownService')<
  TurndownServiceTag,
  {
    readonly turndown: (html: string) => string;
  }
>() {}

export class ReadabilityService extends Context.Tag('ReadabilityService')<
  ReadabilityService,
  {
    readonly parse: (
      html: string,
      url: string
    ) => Effect.Effect<ExtractedContent, ReadabilityParseError | ExtractionError>;
  }
>() {}

export class OffscreenService extends Context.Tag('OffscreenService')<
  OffscreenService,
  {
    readonly extractMarkdown: (
      html: string,
      url: string
    ) => Effect.Effect<ExtractedContent, OffscreenTimeoutError | OffscreenCommunicationError>;
  }
>() {}

export class ExtractService extends Context.Tag('ExtractService')<
  ExtractService,
  {
    readonly extractMarkdown: (
      html: string,
      url: string
    ) => Effect.Effect<ExtractedContent, ExtractError>;
  }
>() {}

// ============================================================================
// Service Implementations
// ============================================================================

/**
 * TurndownService Layer - Provides singleton markdown converter
 */
export const TurndownServiceLive: Layer.Layer<TurndownServiceTag> = Layer.sync(
  TurndownServiceTag,
  () => {
    let instance: TurndownService | null = null;

    const getTurndown = (): TurndownService => {
      instance ??= new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
      });
      return instance;
    };

    return {
      turndown: (html: string) => getTurndown().turndown(html),
    };
  }
);

/**
 * ReadabilityService Layer - Parses HTML using Readability and converts to markdown
 */
export const ReadabilityServiceLive: Layer.Layer<
  ReadabilityService,
  never,
  TurndownServiceTag
> = Layer.effect(
  ReadabilityService,
  Effect.gen(function* () {
    const turndownService = yield* TurndownServiceTag;

    return {
      parse: (html: string, url: string) =>
        Effect.gen(function* () {
          console.log('[Extract] Using native DOMParser', { url, htmlLength: html.length });

          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          const base = doc.createElement('base');
          base.href = url;
          doc.head.insertBefore(base, doc.head.firstChild);

          const reader = new Readability(doc);
          const article = reader.parse();

          if (!article) {
            console.error('[Extract] Readability returned null', { url, htmlLength: html.length });
            return yield* Effect.fail(
              new ReadabilityParseError({
                url,
                htmlLength: html.length,
                message: 'Readability could not parse the page',
              })
            );
          }

          console.log('[Extract] Readability result', {
            title: article.title,
            contentLength: article.content?.length ?? 0,
          });

          const contentDoc = parser.parseFromString(article.content ?? '', 'text/html');
          const markdown = turndownService.turndown(contentDoc.body);

          console.log('[Extract] Markdown conversion complete', { markdownLength: markdown.length });

          return {
            title: article.title ?? '',
            content: markdown,
            excerpt: article.excerpt ?? '',
            byline: article.byline ?? null,
          } satisfies ExtractedContent;
        }),
    };
  })
);

// Retry configuration for offscreen extraction
const EXTRACT_MAX_RETRIES = 3;
const EXTRACT_INITIAL_DELAY_MS = 100;
const EXTRACT_MAX_DELAY_MS = 1000;
const EXTRACT_TIMEOUT_MS = 30000;

interface ExtractContentResponse {
  success: boolean;
  result?: ExtractedContent;
  error?: string;
}

/**
 * OffscreenService Layer - Handles extraction via Chrome offscreen document
 */
export const OffscreenServiceLive: Layer.Layer<OffscreenService> = Layer.sync(
  OffscreenService,
  () => {
    const sendExtractMessage = (
      html: string,
      url: string
    ): Effect.Effect<ExtractedContent, OffscreenTimeoutError | OffscreenCommunicationError> =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            new Promise<ExtractedContent>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(
                  new OffscreenTimeoutError({
                    url,
                    timeoutMs: EXTRACT_TIMEOUT_MS,
                    message: 'Extract timeout via offscreen document',
                  })
                );
              }, EXTRACT_TIMEOUT_MS);

              chrome.runtime.sendMessage(
                { type: 'extract:markdown_from_html', html, url },
                (response: ExtractContentResponse | undefined) => {
                  clearTimeout(timeout);

                  if (chrome.runtime.lastError) {
                    reject(
                      new OffscreenCommunicationError({
                        url,
                        attempt: 1,
                        message: chrome.runtime.lastError.message,
                      })
                    );
                    return;
                  }

                  if (response === undefined) {
                    reject(
                      new OffscreenCommunicationError({
                        url,
                        attempt: 1,
                        message: 'No response from offscreen document',
                      })
                    );
                    return;
                  }

                  if (response.success && response.result !== undefined) {
                    resolve(response.result);
                  } else {
                    reject(
                      new OffscreenCommunicationError({
                        url,
                        attempt: 1,
                        message: response.error ?? 'Unknown extraction error',
                      })
                    );
                  }
                }
              );
            }),
          catch: (error) => {
            if (error instanceof OffscreenTimeoutError) {
              return error;
            }
            if (error instanceof OffscreenCommunicationError) {
              return error;
            }
            return new OffscreenCommunicationError({
              url,
              attempt: 1,
              message: String(error),
            });
          },
        });

        return result;
      });

    const extractMarkdownViaOffscreen = (
      html: string,
      url: string
    ): Effect.Effect<ExtractedContent, OffscreenTimeoutError | OffscreenCommunicationError> =>
      Effect.gen(function* () {
        console.log('[Extract] Using offscreen document (Chrome)', { url, htmlLength: html.length });

        // Dynamically import offscreen module for tree-shaking
        const offscreenModule = yield* Effect.tryPromise({
          try: () => import('../offscreen'),
          catch: (error) =>
            new OffscreenCommunicationError({
              url,
              attempt: 0,
              message: `Failed to load offscreen module: ${String(error)}`,
            }),
        });

        const { ensureOffscreenDocument, resetOffscreenState } = offscreenModule;

        // Ensure offscreen document is ready
        yield* Effect.tryPromise({
          try: () => ensureOffscreenDocument(),
          catch: (error) =>
            new OffscreenCommunicationError({
              url,
              attempt: 0,
              message: `Failed to ensure offscreen document: ${String(error)}`,
            }),
        });

        // Define retry schedule with exponential backoff
        const retrySchedule = Schedule.exponential(Duration.millis(EXTRACT_INITIAL_DELAY_MS)).pipe(
          Schedule.either(Schedule.spaced(Duration.millis(EXTRACT_MAX_DELAY_MS))),
          Schedule.intersect(Schedule.recurs(EXTRACT_MAX_RETRIES - 1))
        );

        // Attempt extraction with retry
        const result = yield* sendExtractMessage(html, url).pipe(
          Effect.retry({
            schedule: retrySchedule,
            while: (error): error is OffscreenCommunicationError => {
              if (error._tag === 'OffscreenCommunicationError') {
                console.warn(
                  `[Extract] Attempt ${error.attempt}/${EXTRACT_MAX_RETRIES} failed:`,
                  error.message
                );
                // Reset offscreen state between retries
                resetOffscreenState();
                // Re-ensure offscreen document
                Effect.runSync(
                  Effect.tryPromise({
                    try: () => ensureOffscreenDocument(),
                    catch: () => undefined,
                  }).pipe(Effect.orElseSucceed(() => undefined))
                );
                return true;
              }
              return false;
            },
          })
        );

        return result;
      });

    return {
      extractMarkdown: extractMarkdownViaOffscreen,
    };
  }
);

/**
 * ExtractService Layer - Main extraction service that chooses between native and offscreen
 */
export const ExtractServiceLive: Layer.Layer<
  ExtractService,
  never,
  ReadabilityService | OffscreenService
> = Layer.effect(
  ExtractService,
  Effect.gen(function* () {
    const readabilityService = yield* ReadabilityService;
    const offscreenService = yield* OffscreenService;

    return {
      extractMarkdown: (html: string, url: string) =>
        Effect.gen(function* () {
          // Use compile-time check to enable dead code elimination
          if (__IS_CHROME__) {
            // Try offscreen first, fallback to native on error
            const result = yield* offscreenService.extractMarkdown(html, url).pipe(
              Effect.catchAll((error) => {
                console.warn('[Extract] Offscreen extraction failed, falling back to native:', error);
                return readabilityService.parse(html, url);
              })
            );
            return result;
          }
          return yield* readabilityService.parse(html, url);
        }),
    };
  })
);

/**
 * ExtractService Layer - Native-only (for Firefox or when offscreen unavailable)
 */
export const ExtractServiceNative: Layer.Layer<ExtractService, never, ReadabilityService> =
  Layer.effect(
    ExtractService,
    Effect.gen(function* () {
      const readabilityService = yield* ReadabilityService;

      return {
        extractMarkdown: readabilityService.parse,
      };
    })
  );

// ============================================================================
// Main Application Layers
// ============================================================================

/**
 * Full extraction layer with offscreen support (Chrome)
 */
export const ExtractLayerChrome: Layer.Layer<ExtractService> = Layer.provide(
  ExtractServiceLive,
  Layer.mergeAll(
    Layer.provide(ReadabilityServiceLive, TurndownServiceLive),
    OffscreenServiceLive
  )
);

/**
 * Native-only extraction layer (Firefox)
 */
export const ExtractLayerNative: Layer.Layer<ExtractService> = Layer.provide(
  ExtractServiceNative,
  Layer.provide(ReadabilityServiceLive, TurndownServiceLive)
);

// ============================================================================
// Public API - Maintains compatibility with original interface
// ============================================================================

/**
 * Async markdown extraction - main entry point
 */
export function extractMarkdownAsync(
  html: string,
  url: string
): Promise<ExtractedContent> {
  const layer = __IS_CHROME__ ? ExtractLayerChrome : ExtractLayerNative;

  const program = Effect.gen(function* () {
    const extractService = yield* ExtractService;
    return yield* extractService.extractMarkdown(html, url);
  });

  return Effect.runPromise(program.pipe(Effect.provide(layer)));
}

/**
 * Synchronous markdown extraction for testing purposes
 */
export function extractMarkdown(html: string, url: string): ExtractedContent {
  const program = Effect.gen(function* () {
    const readabilityService = yield* ReadabilityService;
    return yield* readabilityService.parse(html, url);
  });

  const layer = Layer.provide(ReadabilityServiceLive, TurndownServiceLive);

  return Effect.runSync(program.pipe(Effect.provide(layer)));
}
