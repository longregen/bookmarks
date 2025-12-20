import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { EmbeddingError } from '../lib/errors';

/**
 * Service for generating text embeddings
 */
export class EmbeddingService extends Context.Tag('EmbeddingService')<
  EmbeddingService,
  {
    readonly generate: (
      texts: string[]
    ) => Effect.Effect<number[][], EmbeddingError, never>;
  }
>() {}
