import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import { marked as markedParser } from 'marked';
import DOMPurify from 'dompurify';

// Typed Errors
export class MarkdownParseError extends Data.TaggedError('MarkdownParseError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MarkdownSanitizeError extends Data.TaggedError('MarkdownSanitizeError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Service Tag with inline interface
export class MarkdownService extends Context.Tag('MarkdownService')<
  MarkdownService,
  {
    readonly parseMarkdown: (
      markdown: string
    ) => Effect.Effect<string, MarkdownParseError | MarkdownSanitizeError, never>;
  }
>() {}

// Layer Implementation
export const MarkdownServiceLive: Layer.Layer<MarkdownService, never, never> = Layer.sync(
  MarkdownService,
  () => {
    // Initialize marked parser
    markedParser.setOptions({
      gfm: true,
      breaks: true,
    });

    // Configure DOMPurify hooks
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'src' || data.attrName === 'href') {
        const value = data.attrValue.toLowerCase().trim();
        if (value.startsWith('data:') && !value.startsWith('data:image/')) {
          data.attrValue = '';
        }
      }
    });

    return {
      parseMarkdown: (markdown: string) =>
        Effect.gen(function* () {
          // Parse markdown to HTML
          const html = yield* Effect.try({
            try: () => markedParser.parse(markdown) as string,
            catch: (error) =>
              new MarkdownParseError({
                message: `Failed to parse markdown: ${error}`,
                cause: error,
              }),
          });

          // Sanitize HTML
          const sanitized = yield* Effect.try({
            try: () =>
              DOMPurify.sanitize(html, {
                ADD_ATTR: ['target', 'rel'],
                FORBID_ATTR: ['style'],
              }),
            catch: (error) =>
              new MarkdownSanitizeError({
                message: `Failed to sanitize HTML: ${error}`,
                cause: error,
              }),
          });

          // Add target and rel attributes to links
          return sanitized.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
        }),
    };
  }
);

// Convenience function that maintains backward compatibility
export const parseMarkdown = (
  markdown: string
): Effect.Effect<string, MarkdownParseError | MarkdownSanitizeError, MarkdownService> =>
  Effect.gen(function* () {
    const service = yield* MarkdownService;
    return yield* service.parseMarkdown(markdown);
  });
