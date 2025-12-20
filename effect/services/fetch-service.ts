import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { FetchError } from '../lib/errors';

export class FetchService extends Context.Tag('FetchService')<
  FetchService,
  {
    readonly fetchHtml: (
      url: string,
      timeout: number
    ) => Effect.Effect<{ html: string; title: string | null }, FetchError, never>;
  }
>() {}
