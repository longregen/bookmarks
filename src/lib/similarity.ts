import { SIMILARITY_THRESHOLD } from './constants';

// Debug loggers that compile away when __DEBUG_EMBEDDINGS__ is false
const debugLog = __DEBUG_EMBEDDINGS__
  ? (msg: string, data?: unknown) => console.log(`[Similarity] ${msg}`, data)
  : (_msg: string, _data?: unknown) => {};

const debugError = __DEBUG_EMBEDDINGS__
  ? (msg: string, data?: unknown) => console.error(`[Similarity] ${msg}`, data)
  : (_msg: string, _data?: unknown) => {};

const debugWarn = __DEBUG_EMBEDDINGS__
  ? (msg: string, data?: unknown) => console.warn(`[Similarity] ${msg}`, data)
  : (_msg: string, _data?: unknown) => {};

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b) {
    debugError('cosineSimilarity called with null/undefined vectors', {
      aExists: !!a,
      bExists: !!b,
    });
    throw new Error('Vectors cannot be null or undefined');
  }

  if (!Array.isArray(a) || !Array.isArray(b)) {
    debugError('cosineSimilarity called with non-array values', {
      aType: typeof a,
      bType: typeof b,
      aIsArray: Array.isArray(a),
      bIsArray: Array.isArray(b),
    });
    throw new Error('Vectors must be arrays');
  }

  if (a.length !== b.length) {
    debugError('Vector dimension mismatch', {
      aLength: a.length,
      bLength: b.length,
      aSample: a.slice(0, 3),
      bSample: b.slice(0, 3),
    });
    throw new Error(`Vectors must have the same length (got ${a.length} and ${b.length})`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) {
    debugWarn('Zero magnitude detected - returning 0');
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Find the top K most similar items.
 */
export function findTopK<T>(
  queryEmbedding: number[],
  items: Array<{ item: T; embedding: number[] }>,
  k: number
): Array<{ item: T; score: number }> {
  debugLog('findTopK called', {
    queryDimension: queryEmbedding?.length,
    itemCount: items?.length,
    k,
  });

  if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
    debugError('Invalid query embedding', {
      queryEmbedding,
      type: typeof queryEmbedding,
    });
    throw new Error('Query embedding must be a valid array');
  }

  if (!items || !Array.isArray(items)) {
    debugError('Invalid items array', {
      items,
      type: typeof items,
    });
    throw new Error('Items must be a valid array');
  }

  // Track any errors during scoring
  const errors: Array<{ index: number; error: string }> = [];

  const scored = items.map(({ item, embedding }, index) => {
    try {
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { item, score };
    } catch (err) {
      errors.push({
        index,
        error: err instanceof Error ? err.message : String(err),
      });
      // Return a very low score for invalid items
      return { item, score: -1 };
    }
  });

  if (errors.length > 0) {
    debugError('Errors during similarity calculation', {
      errorCount: errors.length,
      totalItems: items.length,
      errors: errors.slice(0, 5), // Show first 5 errors
    });
  }

  // Filter out items that had errors (score = -1)
  const validScored = scored.filter(s => s.score >= 0);

  debugLog('Scoring complete', {
    totalScored: scored.length,
    validScored: validScored.length,
    errored: errors.length,
    scoreDistribution: {
      excellent: validScored.filter(s => s.score >= SIMILARITY_THRESHOLD.EXCELLENT).length,
      good: validScored.filter(s => s.score >= SIMILARITY_THRESHOLD.GOOD && s.score < SIMILARITY_THRESHOLD.EXCELLENT).length,
      fair: validScored.filter(s => s.score >= SIMILARITY_THRESHOLD.FAIR && s.score < SIMILARITY_THRESHOLD.GOOD).length,
      poor: validScored.filter(s => s.score >= SIMILARITY_THRESHOLD.POOR && s.score < SIMILARITY_THRESHOLD.FAIR).length,
      veryPoor: validScored.filter(s => s.score < SIMILARITY_THRESHOLD.POOR).length,
    },
  });

  validScored.sort((a, b) => b.score - a.score);

  const topK = validScored.slice(0, k);

  if (topK.length > 0) {
    debugLog('Top results', {
      topScores: topK.slice(0, 5).map(r => r.score.toFixed(4)),
    });
  }

  return topK;
}
