import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';

export class TitleExtractor extends Context.Tag('TitleExtractor')<
  TitleExtractor,
  {
    readonly extractFromHtml: (
      html: string
    ) => Effect.Effect<string | null, never, never>;
  }
>() {}
