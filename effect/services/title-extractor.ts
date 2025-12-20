import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';

/**
 * Service for extracting title from HTML content
 */
export class TitleExtractor extends Context.Tag('TitleExtractor')<
  TitleExtractor,
  {
    readonly extractFromHtml: (
      html: string
    ) => Effect.Effect<string | null, never, never>;
  }
>() {}
