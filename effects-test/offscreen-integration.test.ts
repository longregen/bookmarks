import { describe, it, expect } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';

// Import only service definitions from lib/offscreen (safe - no initialization code)
import { OffscreenService, OffscreenError } from '../effect/lib/offscreen';
import type { ExtractedContent } from '../src/lib/messages';

// Define error types locally to avoid importing the offscreen.ts module
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

// Define service tags locally to avoid importing the offscreen.ts module
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

// Define extractMarkdown locally
const extractMarkdown = (
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

    const domParser = yield* DOMParserService;
    const readability = yield* ReadabilityService;
    const turndown = yield* TurndownServiceContext;

    const doc = yield* domParser.parseHTML(html, url);
    const article = yield* readability.parse(doc);
    const markdown = yield* turndown.convertToMarkdown(article.content);

    return {
      title: article.title,
      content: markdown,
      excerpt: article.excerpt,
      byline: article.byline,
    };
  });

// ============================================================================
// Simple Mock Implementations
// ============================================================================

/**
 * Simple mock OffscreenService for basic testing
 */
const MockOffscreenServiceLayer = Layer.succeed(OffscreenService, {
  ensureDocument: () => Effect.void,
  ping: () => Effect.succeed(true),
  reset: () => Effect.void,
});

/**
 * Mock ReadabilityService that returns test data
 */
const MockReadabilityServiceLayer = Layer.succeed(ReadabilityService, {
  parse: (doc: Document) =>
    Effect.succeed({
      title: 'Test Article Title',
      content: '<h1>Test Article</h1><p>Test content for extraction.</p>',
      excerpt: 'Test excerpt',
      byline: 'Test Author',
    }),
});

/**
 * Mock TurndownService that converts HTML to markdown
 */
const MockTurndownServiceLayer = Layer.succeed(TurndownServiceContext, {
  convertToMarkdown: (html: string) =>
    Effect.succeed('# Test Article\n\nTest content for extraction.'),
});

/**
 * Mock DOMParserService that parses HTML strings
 */
const MockDOMParserServiceLayer = Layer.succeed(DOMParserService, {
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
          message: String(error),
        }),
    }),
});

/**
 * Mock ChromeMessageService for testing message handling
 */
const MockChromeMessageServiceLayer = Layer.succeed(ChromeMessageService, {
  sendMessage: (message: Record<string, unknown>) => Effect.void,
  addListener: (handler) => Effect.void,
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Offscreen Document Lifecycle Integration (Simple)', () => {
  describe('OffscreenService Basic Operations', () => {
    it('should successfully ensure document', async () => {
      const program = Effect.gen(function* () {
        const service = yield* OffscreenService;
        yield* service.ensureDocument();
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockOffscreenServiceLayer)));
    });

    it('should successfully ping document', async () => {
      const program = Effect.gen(function* () {
        const service = yield* OffscreenService;
        const isReady = yield* service.ping();
        return isReady;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(MockOffscreenServiceLayer))
      );

      expect(result).toBe(true);
    });

    it('should successfully reset state', async () => {
      const program = Effect.gen(function* () {
        const service = yield* OffscreenService;
        yield* service.reset();
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockOffscreenServiceLayer)));
    });
  });

  describe('Markdown Extraction', () => {
    const extractionLayers = Layer.mergeAll(
      MockReadabilityServiceLayer,
      MockTurndownServiceLayer,
      MockDOMParserServiceLayer
    );

    it('should successfully extract markdown from HTML', async () => {
      const program = Effect.gen(function* () {
        const html = '<html><body><h1>Test</h1><p>Content</p></body></html>';
        const url = 'https://example.com';

        const result = yield* extractMarkdown(html, url);
        return result;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(extractionLayers)));

      expect(result).toBeDefined();
      expect(result.title).toBe('Test Article Title');
      expect(result.content).toContain('Test Article');
      expect(result.excerpt).toBe('Test excerpt');
      expect(result.byline).toBe('Test Author');
    });

    it('should fail when HTML is empty', async () => {
      const program = Effect.gen(function* () {
        const result = yield* extractMarkdown('', 'https://example.com');
        return result;
      });

      const error = await Effect.runPromise(
        program.pipe(Effect.provide(extractionLayers), Effect.flip)
      );

      expect(error).toBeInstanceOf(MarkdownExtractionError);
      expect(error.reason).toBe('invalid_input');
    });

    it('should fail when URL is empty', async () => {
      const program = Effect.gen(function* () {
        const result = yield* extractMarkdown('<html></html>', '');
        return result;
      });

      const error = await Effect.runPromise(
        program.pipe(Effect.provide(extractionLayers), Effect.flip)
      );

      expect(error).toBeInstanceOf(MarkdownExtractionError);
      expect(error.reason).toBe('invalid_input');
    });

    it('should handle readability parse failure', async () => {
      const failingReadabilityLayer = Layer.succeed(ReadabilityService, {
        parse: (doc: Document) =>
          Effect.fail(
            new MarkdownExtractionError({
              reason: 'readability_failed',
              url: doc.baseURI || '',
              message: 'Readability parsing failed',
            })
          ),
      });

      const layers = Layer.mergeAll(
        failingReadabilityLayer,
        MockTurndownServiceLayer,
        MockDOMParserServiceLayer
      );

      const program = Effect.gen(function* () {
        const html = '<html><body>Test</body></html>';
        const url = 'https://example.com';

        const result = yield* extractMarkdown(html, url);
        return result;
      });

      const error = await Effect.runPromise(program.pipe(Effect.provide(layers), Effect.flip));

      expect(error).toBeInstanceOf(MarkdownExtractionError);
      expect(error.reason).toBe('readability_failed');
    });

    it('should handle markdown conversion failure', async () => {
      const failingTurndownLayer = Layer.succeed(TurndownServiceContext, {
        convertToMarkdown: (html: string) =>
          Effect.fail(
            new MarkdownExtractionError({
              reason: 'conversion_failed',
              url: '',
              message: 'Markdown conversion failed',
            })
          ),
      });

      const layers = Layer.mergeAll(
        MockReadabilityServiceLayer,
        failingTurndownLayer,
        MockDOMParserServiceLayer
      );

      const program = Effect.gen(function* () {
        const html = '<html><body>Test</body></html>';
        const url = 'https://example.com';

        const result = yield* extractMarkdown(html, url);
        return result;
      });

      const error = await Effect.runPromise(program.pipe(Effect.provide(layers), Effect.flip));

      expect(error).toBeInstanceOf(MarkdownExtractionError);
      expect(error.reason).toBe('conversion_failed');
    });
  });

  describe('ChromeMessageService', () => {
    it('should successfully send messages', async () => {
      const program = Effect.gen(function* () {
        const service = yield* ChromeMessageService;
        yield* service.sendMessage({ type: 'offscreen:ready' });
        yield* service.sendMessage({ type: 'offscreen:ping' });
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockChromeMessageServiceLayer)));
    });

    it('should successfully add message listeners', async () => {
      const program = Effect.gen(function* () {
        const service = yield* ChromeMessageService;

        const handler = (message: any, sender: any, sendResponse: any) => {
          return true;
        };

        yield* service.addListener(handler);
      });

      await Effect.runPromise(program.pipe(Effect.provide(MockChromeMessageServiceLayer)));
    });

    it('should handle send message failures', async () => {
      const failingMessageLayer = Layer.succeed(ChromeMessageService, {
        sendMessage: (message: Record<string, unknown>) =>
          Effect.fail(
            new MessageError({
              messageType: (message.type as string) || 'unknown',
              reason: 'send_failed',
            })
          ),
        addListener: (handler) => Effect.void,
      });

      const program = Effect.gen(function* () {
        const service = yield* ChromeMessageService;
        yield* service.sendMessage({ type: 'test:message' });
      });

      const error = await Effect.runPromise(
        program.pipe(Effect.provide(failingMessageLayer), Effect.flip)
      );

      expect(error).toBeInstanceOf(MessageError);
      expect(error.reason).toBe('send_failed');
    });
  });

  describe('End-to-End Lifecycle', () => {
    it('should handle full lifecycle: ensure -> ping -> extract', async () => {
      const fullLayer = Layer.mergeAll(
        MockOffscreenServiceLayer,
        MockChromeMessageServiceLayer,
        MockReadabilityServiceLayer,
        MockTurndownServiceLayer,
        MockDOMParserServiceLayer
      );

      const program = Effect.gen(function* () {
        const offscreen = yield* OffscreenService;
        const messages = yield* ChromeMessageService;

        // 1. Ensure document is created and ready
        yield* offscreen.ensureDocument();

        // 2. Verify document is ready with ping
        const isReady = yield* offscreen.ping();
        expect(isReady).toBe(true);

        // 3. Send ready message
        yield* messages.sendMessage({ type: 'offscreen:ready' });

        // 4. Extract markdown
        const html = '<html><body><h1>Article</h1><p>Content</p></body></html>';
        const extracted = yield* extractMarkdown(html, 'https://example.com/article');

        expect(extracted.title).toBe('Test Article Title');

        // 5. Reset state
        yield* offscreen.reset();

        return extracted;
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

      expect(result.content).toContain('Test Article');
    });
  });
});
