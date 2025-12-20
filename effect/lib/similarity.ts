import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import { ConfigService } from '../services/config-service';
import { LoggingService } from '../services/logging-service';

/**
 * Typed error for vector operations
 */
export class VectorError extends Data.TaggedError('VectorError')<{
  readonly reason:
    | 'not_array'
    | 'dimension_mismatch'
    | 'zero_magnitude'
    | 'invalid_input';
  readonly message: string;
  readonly details?: {
    aType?: string;
    bType?: string;
    aLength?: number;
    bLength?: number;
    aSample?: number[];
    bSample?: number[];
    itemsType?: string;
  };
}> {}

/**
 * Compute cosine similarity between two vectors
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Effect that yields similarity score (0-1) or fails with VectorError
 */
export function cosineSimilarity(
  a: number[],
  b: number[]
): Effect.Effect<number, VectorError, LoggingService> {
  return Effect.gen(function* () {
    const logging = yield* LoggingService;

    // Validate inputs are arrays
    if (!Array.isArray(a) || !Array.isArray(b)) {
      yield* logging.debug('cosineSimilarity called with non-array values', {
        aType: typeof a,
        bType: typeof b,
      });
      return yield* Effect.fail(
        new VectorError({
          reason: 'not_array',
          message: 'Vectors must be arrays',
          details: { aType: typeof a, bType: typeof b },
        })
      );
    }

    // Validate dimensions match
    if (a.length !== b.length) {
      yield* logging.debug('Vector dimension mismatch', {
        aLength: a.length,
        bLength: b.length,
        aSample: a.slice(0, 3),
        bSample: b.slice(0, 3),
      });
      return yield* Effect.fail(
        new VectorError({
          reason: 'dimension_mismatch',
          message: `Vectors must have the same length (got ${a.length} and ${b.length})`,
          details: {
            aLength: a.length,
            bLength: b.length,
            aSample: a.slice(0, 3),
            bSample: b.slice(0, 3),
          },
        })
      );
    }

    // Compute dot product and norms
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA * normB);

    // Handle zero magnitude
    if (magnitude === 0) {
      yield* logging.debug('Zero magnitude detected - returning 0');
      return 0;
    }

    return dotProduct / magnitude;
  });
}

/**
 * Find top K items by cosine similarity to query embedding
 *
 * @param queryEmbedding - Query vector
 * @param items - Items with embeddings to score
 * @param k - Number of top results to return
 * @returns Effect that yields top K scored items or fails with VectorError
 */
export function findTopK<T>(
  queryEmbedding: number[],
  items: { item: T; embedding: number[] }[],
  k: number
): Effect.Effect<
  { item: T; score: number }[],
  VectorError,
  ConfigService | LoggingService
> {
  return Effect.gen(function* () {
    const logging = yield* LoggingService;
    const config = yield* ConfigService;

    yield* logging.debug('findTopK called', {
      queryDimension: queryEmbedding.length,
      itemCount: items.length,
      k,
    });

    // Validate query embedding
    if (!Array.isArray(queryEmbedding)) {
      yield* logging.debug('Invalid query embedding', {
        queryEmbedding,
        type: typeof queryEmbedding,
      });
      return yield* Effect.fail(
        new VectorError({
          reason: 'invalid_input',
          message: 'Query embedding must be a valid array',
        })
      );
    }

    // Validate items array
    if (!Array.isArray(items)) {
      yield* logging.debug('Invalid items array', {
        items,
        type: typeof items,
      });
      return yield* Effect.fail(
        new VectorError({
          reason: 'invalid_input',
          message: 'Items must be a valid array',
          details: { itemsType: typeof items },
        })
      );
    }

    const errors: { index: number; error: string }[] = [];

    // Compute similarity scores for all items
    const scored = yield* Effect.all(
      items.map(({ item, embedding }, index) =>
        cosineSimilarity(queryEmbedding, embedding).pipe(
          Effect.map(score => ({ item, score })),
          Effect.catchAll(err => {
            errors.push({
              index,
              error: err.message,
            });
            return Effect.succeed({ item, score: -1 });
          })
        )
      ),
      { concurrency: 'unbounded' }
    );

    // Log errors if any occurred
    if (errors.length > 0) {
      yield* logging.debug('Errors during similarity calculation', {
        errorCount: errors.length,
        totalItems: items.length,
        errors: errors.slice(0, 5),
      });
    }

    // Filter out failed items
    const validScored = scored.filter(s => s.score >= 0);

    // Get similarity thresholds from config with defaults
    const thresholdExcellent = yield* config
      .get<number>('SIMILARITY_THRESHOLD_EXCELLENT')
      .pipe(Effect.orElseSucceed(() => 0.9));

    const thresholdGood = yield* config
      .get<number>('SIMILARITY_THRESHOLD_GOOD')
      .pipe(Effect.orElseSucceed(() => 0.75));

    const thresholdFair = yield* config
      .get<number>('SIMILARITY_THRESHOLD_FAIR')
      .pipe(Effect.orElseSucceed(() => 0.6));

    const thresholdPoor = yield* config
      .get<number>('SIMILARITY_THRESHOLD_POOR')
      .pipe(Effect.orElseSucceed(() => 0.4));

    // Calculate score distribution for debugging
    const scoreDistribution = validScored.reduce(
      (acc, s) => {
        if (s.score >= thresholdExcellent) acc.excellent++;
        else if (s.score >= thresholdGood) acc.good++;
        else if (s.score >= thresholdFair) acc.fair++;
        else if (s.score >= thresholdPoor) acc.poor++;
        else acc.veryPoor++;
        return acc;
      },
      { excellent: 0, good: 0, fair: 0, poor: 0, veryPoor: 0 }
    );

    yield* logging.debug('Scoring complete', {
      totalScored: scored.length,
      validScored: validScored.length,
      errored: errors.length,
      scoreDistribution,
    });

    // Sort by score descending
    validScored.sort((a, b) => b.score - a.score);

    // Take top K
    const topK = validScored.slice(0, k);

    if (topK.length > 0) {
      yield* logging.debug('Top results', {
        topScores: topK.slice(0, 5).map(r => r.score.toFixed(4)),
      });
    }

    return topK;
  });
}
