/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b) {
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Similarity] cosineSimilarity called with null/undefined vectors', {
        aExists: !!a,
        bExists: !!b,
      });
    }
    throw new Error('Vectors cannot be null or undefined');
  }

  if (!Array.isArray(a) || !Array.isArray(b)) {
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Similarity] cosineSimilarity called with non-array values', {
        aType: typeof a,
        bType: typeof b,
        aIsArray: Array.isArray(a),
        bIsArray: Array.isArray(b),
      });
    }
    throw new Error('Vectors must be arrays');
  }

  if (a.length !== b.length) {
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Similarity] Vector dimension mismatch', {
        aLength: a.length,
        bLength: b.length,
        aSample: a.slice(0, 3),
        bSample: b.slice(0, 3),
      });
    }
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
    if (__DEBUG_EMBEDDINGS__) {
      console.warn('[Similarity] Zero magnitude detected - returning 0');
    }
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
  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Similarity] findTopK called', {
      queryDimension: queryEmbedding?.length,
      itemCount: items?.length,
      k,
    });
  }

  if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Similarity] Invalid query embedding', {
        queryEmbedding,
        type: typeof queryEmbedding,
      });
    }
    throw new Error('Query embedding must be a valid array');
  }

  if (!items || !Array.isArray(items)) {
    if (__DEBUG_EMBEDDINGS__) {
      console.error('[Similarity] Invalid items array', {
        items,
        type: typeof items,
      });
    }
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

  if (__DEBUG_EMBEDDINGS__ && errors.length > 0) {
    console.error('[Similarity] Errors during similarity calculation', {
      errorCount: errors.length,
      totalItems: items.length,
      errors: errors.slice(0, 5), // Show first 5 errors
    });
  }

  // Filter out items that had errors (score = -1)
  const validScored = scored.filter(s => s.score >= 0);

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Similarity] Scoring complete', {
      totalScored: scored.length,
      validScored: validScored.length,
      errored: errors.length,
      scoreDistribution: {
        above90: validScored.filter(s => s.score >= 0.9).length,
        '70to90': validScored.filter(s => s.score >= 0.7 && s.score < 0.9).length,
        '50to70': validScored.filter(s => s.score >= 0.5 && s.score < 0.7).length,
        '30to50': validScored.filter(s => s.score >= 0.3 && s.score < 0.5).length,
        below30: validScored.filter(s => s.score < 0.3).length,
      },
    });
  }

  validScored.sort((a, b) => b.score - a.score);

  const topK = validScored.slice(0, k);

  if (__DEBUG_EMBEDDINGS__ && topK.length > 0) {
    console.log('[Similarity] Top results', {
      topScores: topK.slice(0, 5).map(r => r.score.toFixed(4)),
    });
  }

  return topK;
}
