import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect, Layer, Context } from 'effect';
import type {
  SaveBookmarkResponse,
  GetPageHtmlResponse,
  ExtractedContent,
} from '../effect/lib/messages';
import {
  PageContentService,
  RuntimeMessagingService,
  MessagingError,
  DOMError,
  capturePage,
  getCurrentPageHtml,
} from '../effect/content/capture';
import {
  extractHtml,
  HtmlExtractionError,
} from '../effect/content/extract-html';
import {
  extractMarkdown,
  MarkdownExtractionError,
  ReadabilityService,
  TurndownServiceContext,
  DOMParserService,
} from '../effect/offscreen/offscreen';

describe('Content Capture & Extraction Integration', () => {
  describe('PageContentService Mock', () => {
    it('should successfully get page content', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com/test'),
        getTitle: Effect.succeed('Test Page Title'),
        getHtml: Effect.succeed('<html><body>Test content</body></html>'),
      });

      const program = Effect.gen(function* () {
        const service = yield* PageContentService;
        const url = yield* service.getUrl;
        const title = yield* service.getTitle;
        const html = yield* service.getHtml;

        return { url, title, html };
      });

      const result = await Effect.runPromise(program.pipe(Effect.provide(mockLayer)));

      expect(result.url).toBe('https://example.com/test');
      expect(result.title).toBe('Test Page Title');
      expect(result.html).toBe('<html><body>Test content</body></html>');
    });

    it('should handle DOM errors when getting URL', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.fail(
          new DOMError({
            operation: 'getUrl',
            message: 'Location is restricted',
          })
        ),
        getTitle: Effect.succeed(''),
        getHtml: Effect.succeed(''),
      });

      const program = Effect.gen(function* () {
        const service = yield* PageContentService;
        return yield* service.getUrl;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(mockLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(DOMError);
      expect(result.operation).toBe('getUrl');
      expect(result.message).toContain('restricted');
    });

    it('should handle DOM errors when getting HTML', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com'),
        getTitle: Effect.succeed('Test'),
        getHtml: Effect.fail(
          new DOMError({
            operation: 'getHtml',
            message: 'Document unavailable',
          })
        ),
      });

      const program = Effect.gen(function* () {
        const service = yield* PageContentService;
        return yield* service.getHtml;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(mockLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(DOMError);
      expect(result.operation).toBe('getHtml');
    });
  });

  describe('HTML Extraction Effect', () => {
    beforeEach(() => {
      // Create a minimal DOM for testing
      document.body.innerHTML = '<div id="content">Initial content</div>';
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('should extract HTML after DOM settles', async () => {
      const program = extractHtml(100); // Short settle time for tests

      const result = await Effect.runPromise(program);

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<div id="content">Initial content</div>');
    });

    it('should handle DOM mutations during settling', async () => {
      const program = Effect.gen(function* () {
        // Start extraction with longer settle time
        const extractionEffect = extractHtml(200);

        // Simulate DOM mutation
        setTimeout(() => {
          const newDiv = document.createElement('div');
          newDiv.id = 'dynamic';
          newDiv.textContent = 'Dynamic content';
          document.body.appendChild(newDiv);
        }, 50);

        return yield* extractionEffect;
      });

      const result = await Effect.runPromise(program);

      expect(result).toContain('Dynamic content');
    });

    it('should fail when document is unavailable', async () => {
      // Mock document as undefined
      const originalDocument = globalThis.document;
      // @ts-expect-error - Testing edge case
      globalThis.document = undefined;

      const program = extractHtml(100);

      const result = await Effect.runPromise(program.pipe(Effect.flip));

      expect(result).toBeInstanceOf(HtmlExtractionError);
      expect(result.reason).toBe('dom_unavailable');

      // Restore document
      globalThis.document = originalDocument;
    });
  });

  describe('Capture → Service Worker Message Flow', () => {
    it('should send bookmark save message successfully', async () => {
      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) =>
          Effect.succeed({
            success: true,
            bookmarkId: 'test-bookmark-123',
          } as T),
      });

      const mockPageLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com/article'),
        getTitle: Effect.succeed('Test Article'),
        getHtml: Effect.succeed('<html><body><h1>Article</h1></body></html>'),
      });

      const appLayer = Layer.mergeAll(mockMessagingLayer, mockPageLayer);

      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer))
      );

      expect(result).toBeUndefined(); // Effect.void returns undefined
    });

    it('should handle messaging errors', async () => {
      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) =>
          Effect.fail(
            new MessagingError({
              message: 'Runtime disconnected',
            })
          ),
      });

      const mockPageLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com'),
        getTitle: Effect.succeed('Test'),
        getHtml: Effect.succeed('<html></html>'),
      });

      const appLayer = Layer.mergeAll(mockMessagingLayer, mockPageLayer);

      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(MessagingError);
      expect(result.message).toContain('Runtime disconnected');
    });

    it('should handle failed bookmark save response', async () => {
      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) =>
          Effect.succeed({
            success: false,
            error: 'Database error',
          } as T),
      });

      const mockPageLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com'),
        getTitle: Effect.succeed('Test'),
        getHtml: Effect.succeed('<html></html>'),
      });

      const appLayer = Layer.mergeAll(mockMessagingLayer, mockPageLayer);

      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(MessagingError);
      expect(result.message).toContain('Bookmark save failed');
    });

    it('should get current page HTML via message handler', async () => {
      const mockPageLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com'),
        getTitle: Effect.succeed('Test'),
        getHtml: Effect.succeed('<html><body>Test HTML</body></html>'),
      });

      const result = await Effect.runPromise(
        getCurrentPageHtml.pipe(Effect.provide(mockPageLayer))
      );

      expect(result).toBe('<html><body>Test HTML</body></html>');
    });
  });

  describe('Offscreen Markdown Extraction', () => {
    const mockReadabilityLayer = Layer.succeed(ReadabilityService, {
      parse: (doc: Document) =>
        Effect.succeed({
          title: doc.title || 'Test Article',
          content: '<h1>Test Article</h1><p>Article content here.</p>',
          excerpt: 'Article content here.',
          byline: 'Test Author',
        }),
    });

    const mockTurndownLayer = Layer.succeed(TurndownServiceContext, {
      convertToMarkdown: (html: string) => {
        // Simple mock conversion
        const simpleMarkdown = html
          .replace(/<h1>/g, '# ')
          .replace(/<\/h1>/g, '\n')
          .replace(/<p>/g, '')
          .replace(/<\/p>/g, '\n')
          .replace(/<[^>]*>/g, '');
        return Effect.succeed(simpleMarkdown);
      },
    });

    const mockDOMParserLayer = Layer.succeed(DOMParserService, {
      parseHTML: (html: string, baseUrl: string) =>
        Effect.sync(() => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const base = doc.createElement('base');
          base.href = baseUrl;
          doc.head.insertBefore(base, doc.head.firstChild);
          return doc;
        }),
    });

    const offscreenLayer = Layer.mergeAll(
      mockReadabilityLayer,
      mockTurndownLayer,
      mockDOMParserLayer
    );

    it('should extract markdown from HTML successfully', async () => {
      const html = '<html><head><title>Test</title></head><body><h1>Article</h1></body></html>';
      const url = 'https://example.com/article';

      const result = await Effect.runPromise(
        extractMarkdown(html, url).pipe(Effect.provide(offscreenLayer))
      );

      expect(result.title).toBe('Test Article');
      expect(result.content).toContain('# Test Article');
      expect(result.excerpt).toBe('Article content here.');
      expect(result.byline).toBe('Test Author');
    });

    it('should handle invalid input errors', async () => {
      const result = await Effect.runPromise(
        extractMarkdown('', '').pipe(
          Effect.provide(offscreenLayer),
          Effect.flip
        )
      );

      expect(result).toBeInstanceOf(MarkdownExtractionError);
      expect(result.reason).toBe('invalid_input');
      expect(result.message).toContain('HTML and URL are required');
    });

    it('should handle Readability parsing errors', async () => {
      const failingReadabilityLayer = Layer.succeed(ReadabilityService, {
        parse: (_doc: Document) =>
          Effect.fail(
            new MarkdownExtractionError({
              reason: 'readability_failed',
              url: 'https://example.com',
              message: 'Readability returned null',
            })
          ),
      });

      const failingLayer = Layer.mergeAll(
        failingReadabilityLayer,
        mockTurndownLayer,
        mockDOMParserLayer
      );

      const html = '<html><body>Test</body></html>';
      const url = 'https://example.com';

      const result = await Effect.runPromise(
        extractMarkdown(html, url).pipe(Effect.provide(failingLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(MarkdownExtractionError);
      expect(result.reason).toBe('readability_failed');
    });

    it('should handle Turndown conversion errors', async () => {
      const failingTurndownLayer = Layer.succeed(TurndownServiceContext, {
        convertToMarkdown: (_html: string) =>
          Effect.fail(
            new MarkdownExtractionError({
              reason: 'conversion_failed',
              url: '',
              message: 'Turndown conversion failed',
            })
          ),
      });

      const failingLayer = Layer.mergeAll(
        mockReadabilityLayer,
        failingTurndownLayer,
        mockDOMParserLayer
      );

      const html = '<html><body>Test</body></html>';
      const url = 'https://example.com';

      const result = await Effect.runPromise(
        extractMarkdown(html, url).pipe(Effect.provide(failingLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(MarkdownExtractionError);
      expect(result.reason).toBe('conversion_failed');
    });

    it('should handle DOM parsing errors', async () => {
      const failingDOMParserLayer = Layer.succeed(DOMParserService, {
        parseHTML: (_html: string, baseUrl: string) =>
          Effect.fail(
            new MarkdownExtractionError({
              reason: 'parse_error',
              url: baseUrl,
              message: 'DOM parsing failed',
            })
          ),
      });

      const failingLayer = Layer.mergeAll(
        mockReadabilityLayer,
        mockTurndownLayer,
        failingDOMParserLayer
      );

      const html = '<html><body>Test</body></html>';
      const url = 'https://example.com';

      const result = await Effect.runPromise(
        extractMarkdown(html, url).pipe(Effect.provide(failingLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(MarkdownExtractionError);
      expect(result.reason).toBe('parse_error');
    });
  });

  describe('Error Handling for Restricted Pages', () => {
    it('should handle chrome:// URLs', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.fail(
          new DOMError({
            operation: 'getUrl',
            message: 'Cannot access chrome:// URLs',
          })
        ),
        getTitle: Effect.succeed(''),
        getHtml: Effect.succeed(''),
      });

      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) => Effect.succeed({} as T),
      });

      const appLayer = Layer.mergeAll(mockLayer, mockMessagingLayer);

      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(DOMError);
      expect(result.message).toContain('chrome://');
    });

    it('should handle about:blank pages', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('about:blank'),
        getTitle: Effect.succeed(''),
        getHtml: Effect.succeed('<html><head></head><body></body></html>'),
      });

      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) =>
          Effect.succeed({
            success: true,
          } as T),
      });

      const appLayer = Layer.mergeAll(mockLayer, mockMessagingLayer);

      // Should succeed but with minimal content
      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer))
      );

      expect(result).toBeUndefined(); // Effect.void
    });

    it('should handle restricted extension pages', async () => {
      const mockLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.fail(
          new DOMError({
            operation: 'getUrl',
            message: 'Cannot access extension pages',
          })
        ),
        getTitle: Effect.succeed(''),
        getHtml: Effect.succeed(''),
      });

      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(_message: unknown) => Effect.succeed({} as T),
      });

      const appLayer = Layer.mergeAll(mockLayer, mockMessagingLayer);

      const result = await Effect.runPromise(
        capturePage.pipe(Effect.provide(appLayer), Effect.flip)
      );

      expect(result).toBeInstanceOf(DOMError);
      expect(result.operation).toBe('getUrl');
    });
  });

  describe('End-to-End Integration Flow', () => {
    it('should complete full capture and extraction flow', async () => {
      // 1. Capture page content
      const mockPageLayer = Layer.succeed(PageContentService, {
        getUrl: Effect.succeed('https://example.com/blog/post'),
        getTitle: Effect.succeed('My Blog Post'),
        getHtml: Effect.succeed(
          '<html><head><title>My Blog Post</title></head><body><article><h1>Blog Post Title</h1><p>This is the content.</p></article></body></html>'
        ),
      });

      let capturedData: { url: string; title: string; html: string } | null = null;

      const mockMessagingLayer = Layer.succeed(RuntimeMessagingService, {
        sendMessage: <T>(message: unknown) => {
          const msg = message as { type: string; data?: { url: string; title: string; html: string } };
          if (msg.type === 'bookmark:save_from_page' && msg.data) {
            capturedData = msg.data;
          }
          return Effect.succeed({ success: true } as T);
        },
      });

      const captureLayer = Layer.mergeAll(mockPageLayer, mockMessagingLayer);

      // Execute capture
      await Effect.runPromise(capturePage.pipe(Effect.provide(captureLayer)));

      expect(capturedData).not.toBeNull();
      expect(capturedData?.url).toBe('https://example.com/blog/post');
      expect(capturedData?.title).toBe('My Blog Post');
      expect(capturedData?.html).toContain('Blog Post Title');

      // 2. Extract markdown from captured HTML
      const mockReadabilityLayer = Layer.succeed(ReadabilityService, {
        parse: (_doc: Document) =>
          Effect.succeed({
            title: 'Blog Post Title',
            content: '<h1>Blog Post Title</h1><p>This is the content.</p>',
            excerpt: 'This is the content.',
            byline: null,
          }),
      });

      const mockTurndownLayer = Layer.succeed(TurndownServiceContext, {
        convertToMarkdown: (html: string) => {
          const markdown = html
            .replace(/<h1>/g, '# ')
            .replace(/<\/h1>/g, '\n')
            .replace(/<p>/g, '')
            .replace(/<\/p>/g, '\n');
          return Effect.succeed(markdown);
        },
      });

      const mockDOMParserLayer = Layer.succeed(DOMParserService, {
        parseHTML: (html: string, baseUrl: string) =>
          Effect.sync(() => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const base = doc.createElement('base');
            base.href = baseUrl;
            doc.head.insertBefore(base, doc.head.firstChild);
            return doc;
          }),
      });

      const extractionLayer = Layer.mergeAll(
        mockReadabilityLayer,
        mockTurndownLayer,
        mockDOMParserLayer
      );

      // Extract markdown using captured data
      const markdownResult = await Effect.runPromise(
        extractMarkdown(capturedData!.html, capturedData!.url).pipe(
          Effect.provide(extractionLayer)
        )
      );

      expect(markdownResult.title).toBe('Blog Post Title');
      expect(markdownResult.content).toContain('# Blog Post Title');
      expect(markdownResult.content).toContain('This is the content.');
      expect(markdownResult.excerpt).toBe('This is the content.');
    });
  });
});
