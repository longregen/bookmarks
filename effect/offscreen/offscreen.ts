import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { makeLayer, makeEffectLayer } from '../lib/effect-utils';
import type { ExtractedContent, OffscreenReadyResponse } from '../lib/messages';
import { getErrorMessage } from '../lib/errors';

// ============================================================================
// Error Types
// ============================================================================

export class MarkdownExtractionError extends Data.TaggedError('MarkdownExtractionError')<{
  readonly reason: 'readability_failed' | 'invalid_input' | 'parse_error' | 'conversion_failed';
  readonly url: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MessageError extends Data.TaggedError('MessageError')<{
  readonly messageType: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

export class ReadabilityService extends Context.Tag('ReadabilityService')<
  ReadabilityService,
  {
    readonly parse: (
      doc: Document
    ) => Effect.Effect<
      {
        title: string;
        content: string;
        excerpt: string;
        byline: string | null;
      },
      MarkdownExtractionError,
      never
    >;
  }
>() {}

export class TurndownServiceContext extends Context.Tag('TurndownService')<
  TurndownServiceContext,
  {
    readonly convertToMarkdown: (
      html: string
    ) => Effect.Effect<string, MarkdownExtractionError, never>;
  }
>() {}

export class DOMParserService extends Context.Tag('DOMParserService')<
  DOMParserService,
  {
    readonly parseHTML: (
      html: string,
      baseUrl: string
    ) => Effect.Effect<Document, MarkdownExtractionError, never>;
  }
>() {}

export class ChromeMessageService extends Context.Tag('ChromeMessageService')<
  ChromeMessageService,
  {
    readonly sendMessage: (
      message: Record<string, unknown>
    ) => Effect.Effect<void, MessageError, never>;
    readonly addListener: (
      handler: (
        message: { type: string; html?: string; url?: string },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean
    ) => Effect.Effect<void, never, never>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

export const ReadabilityServiceLive: Layer.Layer<ReadabilityService, never, never> =
  makeLayer(ReadabilityService, {
    parse: (doc: Document) =>
      Effect.try({
        try: () => {
          const reader = new Readability(doc);
          const article = reader.parse();

          if (!article) {
            throw new Error('Readability returned null');
          }

          return {
            title: article.title ?? '',
            content: article.content ?? '',
            excerpt: article.excerpt ?? '',
            byline: article.byline ?? null,
          };
        },
        catch: (error) =>
          new MarkdownExtractionError({
            reason: 'readability_failed',
            url: doc.baseURI,
            message: getErrorMessage(error),
            cause: error,
          }),
      }),
  });

export const TurndownServiceLive: Layer.Layer<TurndownServiceContext, never, never> =
  Layer.sync(TurndownServiceContext, () => {
    let turndownInstance: TurndownService | null = null;

    const getTurndown = (): TurndownService => {
      turndownInstance ??= new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
      });
      return turndownInstance;
    };

    return {
      convertToMarkdown: (html: string) =>
        Effect.try({
          try: () => {
            const parser = new DOMParser();
            const contentDoc = parser.parseFromString(html, 'text/html');
            return getTurndown().turndown(contentDoc.body);
          },
          catch: (error) =>
            new MarkdownExtractionError({
              reason: 'conversion_failed',
              url: '',
              message: getErrorMessage(error),
              cause: error,
            }),
        }),
    };
  });

export const DOMParserServiceLive: Layer.Layer<DOMParserService, never, never> =
  makeLayer(DOMParserService, {
    parseHTML: (html: string, baseUrl: string) =>
      Effect.try({
        try: () => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          const base = doc.createElement('base');
          base.href = baseUrl;
          doc.head.insertBefore(base, doc.head.firstChild);

          return doc;
        },
        catch: (error) =>
          new MarkdownExtractionError({
            reason: 'parse_error',
            url: baseUrl,
            message: getErrorMessage(error),
            cause: error,
          }),
      }),
  });

export const ChromeMessageServiceLive: Layer.Layer<ChromeMessageService, never, never> =
  makeLayer(ChromeMessageService, {
    sendMessage: (message: Record<string, unknown>) =>
      Effect.tryPromise({
        try: () => chrome.runtime.sendMessage(message),
        catch: (error) =>
          new MessageError({
            messageType: (message.type as string) ?? 'unknown',
            reason: 'send_failed',
            cause: error,
          }),
      }).pipe(Effect.asVoid),
    addListener: (handler) =>
      Effect.sync(() => {
        chrome.runtime.onMessage.addListener(handler);
      }),
  });

// ============================================================================
// Business Logic
// ============================================================================

export const extractMarkdown = (
  html: string,
  url: string
): Effect.Effect<
  ExtractedContent,
  MarkdownExtractionError,
  ReadabilityService | TurndownServiceContext | DOMParserService
> =>
  Effect.gen(function* () {
    if (!html || !url) {
      yield* Effect.fail(
        new MarkdownExtractionError({
          reason: 'invalid_input',
          url,
          message: 'HTML and URL are required',
        })
      );
    }

    yield* Effect.logDebug('[Offscreen] Extracting markdown', {
      url,
      htmlLength: html.length,
    });

    const domParser = yield* DOMParserService;
    const readability = yield* ReadabilityService;
    const turndown = yield* TurndownServiceContext;

    const doc = yield* domParser.parseHTML(html, url);

    yield* Effect.logDebug('[Offscreen] Parsing with Readability');
    const article = yield* readability.parse(doc);

    yield* Effect.logDebug('[Offscreen] Readability result', {
      title: article.title,
      contentLength: article.content.length,
    });

    yield* Effect.logDebug('[Offscreen] Converting to markdown');
    const markdown = yield* turndown.convertToMarkdown(article.content);

    yield* Effect.logDebug('[Offscreen] Markdown conversion complete', {
      markdownLength: markdown.length,
    });

    return {
      title: article.title,
      content: markdown,
      excerpt: article.excerpt,
      byline: article.byline,
    };
  });

// ============================================================================
// Message Handlers
// ============================================================================

const handlePingMessage = (): Effect.Effect<
  OffscreenReadyResponse,
  never,
  never
> =>
  Effect.succeed({
    ready: true,
  });

const handleExtractMarkdownMessage = (
  html: string | undefined,
  url: string | undefined
): Effect.Effect<
  { success: true; result: ExtractedContent } | { success: false; error: string },
  never,
  ReadabilityService | TurndownServiceContext | DOMParserService
> =>
  Effect.gen(function* () {
    if (!html || !url) {
      return {
        success: false as const,
        error: 'HTML and URL are required',
      };
    }

    const result = yield* extractMarkdown(html, url).pipe(
      Effect.match({
        onFailure: (error) => ({
          success: false as const,
          error: error.message,
        }),
        onSuccess: (result) => ({
          success: true as const,
          result,
        }),
      })
    );

    return result;
  });

const makeMessageHandler = (runtime: Effect.Runtime<
  ReadabilityService | TurndownServiceContext | DOMParserService | ChromeMessageService
>) =>
  (message: { type: string; html?: string; url?: string },
   _sender: chrome.runtime.MessageSender,
   sendResponse: (response: unknown) => void
  ): boolean => {
    if (message.type === 'offscreen:ping') {
      const responseEffect = handlePingMessage();
      Effect.runPromise(responseEffect).then(sendResponse);
      return true;
    }

    if (message.type === 'extract:markdown_from_html') {
      const responseEffect = handleExtractMarkdownMessage(message.html, message.url);
      Effect.runPromise(responseEffect, { runtime }).then(sendResponse);
      return true;
    }

    return false;
  };

// ============================================================================
// Runtime Setup
// ============================================================================

export const MainLayer = Layer.mergeAll(
  ReadabilityServiceLive,
  TurndownServiceLive,
  DOMParserServiceLive,
  ChromeMessageServiceLive
);

export const makeRuntime = () => Effect.runSync(Layer.toRuntime(MainLayer));

// ============================================================================
// Initialization
// ============================================================================

const initialize = (runtime: Effect.Runtime<
  ReadabilityService | TurndownServiceContext | DOMParserService | ChromeMessageService
>): Effect.Effect<
  void,
  MessageError,
  ChromeMessageService
> =>
  Effect.gen(function* () {
    yield* Effect.logInfo('[Offscreen] Document loaded');

    const messageService = yield* ChromeMessageService;

    yield* messageService.sendMessage({ type: 'offscreen:ready' }).pipe(
      Effect.catchAll(() => Effect.void)
    );

    yield* messageService.addListener(makeMessageHandler(runtime));
  });

// Skip during tests to avoid initialization errors
// Check if we're not in a test environment (vitest sets describe globally)
if (!import.meta.vitest && typeof describe === 'undefined') {
  // Initialize the offscreen document
  const runtime = makeRuntime();
  console.log('[Offscreen] Document loaded');

  Effect.runPromise(initialize(runtime), { runtime }).catch((error) => {
    console.error('[Offscreen] Initialization failed:', getErrorMessage(error));
  });
}
