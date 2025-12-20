import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { MarkdownError } from '../lib/errors';

/**
 * Service for extracting markdown from HTML content
 */
export class MarkdownService extends Context.Tag('MarkdownService')<
  MarkdownService,
  {
    readonly extract: (
      html: string,
      url: string
    ) => Effect.Effect<{ content: string }, MarkdownError, never>;
  }
>() {}
