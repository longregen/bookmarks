import { config } from './config-registry';
import { createDebugLog, debugOnly } from './debug';

const debugLog = createDebugLog('Similarity');

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    debugLog('cosineSimilarity called with non-array values', {
      aType: typeof a,
      bType: typeof b,
    });
    throw new Error('Vectors must be arrays');
  }

  if (a.length !== b.length) {
    debugLog('Vector dimension mismatch', {
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

  const magnitude = Math.sqrt(normA * normB);

  if (magnitude === 0) {
    debugLog('Zero magnitude detected - returning 0');
    return 0;
  }

  return dotProduct / magnitude;
}

export function findTopK<T>(
  queryEmbedding: number[],
  items: { item: T; embedding: number[] }[],
  k: number
): { item: T; score: number }[] {
  debugLog('findTopK called', {
    queryDimension: queryEmbedding.length,
    itemCount: items.length,
    k,
  });

  if (!Array.isArray(queryEmbedding)) {
    debugLog('Invalid query embedding', {
      queryEmbedding,
      type: typeof queryEmbedding,
    });
    throw new Error('Query embedding must be a valid array');
  }

  if (!Array.isArray(items)) {
    debugLog('Invalid items array', {
      items,
      type: typeof items,
    });
    throw new Error('Items must be a valid array');
  }

  const errors: { index: number; error: string }[] = [];

  const scored = items.map(({ item, embedding }, index) => {
    try {
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { item, score };
    } catch (err) {
      errors.push({
        index,
        error: String(err instanceof Error ? err.message : err),
      });
      return { item, score: -1 };
    }
  });

  if (errors.length > 0) {
    debugLog('Errors during similarity calculation', {
      errorCount: errors.length,
      totalItems: items.length,
      errors: errors.slice(0, 5),
    });
  }

  const validScored = scored.filter(s => s.score >= 0);

  debugOnly(() => {
    const scoreDistribution = validScored.reduce(
      (acc, s) => {
        if (s.score >= config.SIMILARITY_THRESHOLD_EXCELLENT) acc.excellent++;
        else if (s.score >= config.SIMILARITY_THRESHOLD_GOOD) acc.good++;
        else if (s.score >= config.SIMILARITY_THRESHOLD_FAIR) acc.fair++;
        else if (s.score >= config.SIMILARITY_THRESHOLD_POOR) acc.poor++;
        else acc.veryPoor++;
        return acc;
      },
      { excellent: 0, good: 0, fair: 0, poor: 0, veryPoor: 0 }
    );

    debugLog('Scoring complete', {
      totalScored: scored.length,
      validScored: validScored.length,
      errored: errors.length,
      scoreDistribution,
    });
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
