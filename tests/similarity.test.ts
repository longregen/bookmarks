import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity, findTopK } from '../src/lib/similarity';

describe('Similarity functions', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(1);
    });

    it('should return 1 for identical normalized vectors', () => {
      const a = [0.6, 0.8, 0];
      const b = [0.6, 0.8, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(cosineSimilarity(a, b)).toBe(-1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should handle normalized embedding vectors', () => {
      // Typical embedding vectors are normalized
      const a = [0.5, 0.5, 0.5, 0.5];
      const b = [0.5, 0.5, 0.5, 0.5];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    });

    it('should calculate similarity correctly for similar vectors', () => {
      const a = [1, 2, 3];
      const b = [1, 2, 4];
      const result = cosineSimilarity(a, b);
      // These vectors are similar but not identical
      expect(result).toBeGreaterThan(0.95);
      expect(result).toBeLessThan(1);
    });

    it('should handle larger dimension vectors', () => {
      const size = 1536; // Typical embedding size
      const a = Array(size).fill(0).map((_, i) => Math.sin(i));
      const b = Array(size).fill(0).map((_, i) => Math.sin(i));
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    });

    it('should throw error for non-array inputs', () => {
      expect(() => cosineSimilarity(null as any, [1, 2, 3])).toThrow('Vectors must be arrays');
      expect(() => cosineSimilarity([1, 2, 3], undefined as any)).toThrow('Vectors must be arrays');
      expect(() => cosineSimilarity('not array' as any, [1, 2, 3])).toThrow('Vectors must be arrays');
    });

    it('should throw error for mismatched vector lengths', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(() => cosineSimilarity(a, b)).toThrow('Vectors must have the same length (got 3 and 2)');
    });

    it('should return 0 for zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should handle negative values', () => {
      const a = [-1, -2, -3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    });

    it('should handle mixed positive and negative values', () => {
      const a = [1, -1, 1];
      const b = [-1, 1, -1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
    });
  });

  describe('findTopK', () => {
    interface TestItem {
      id: string;
      name: string;
    }

    let items: { item: TestItem; embedding: number[] }[];

    beforeEach(() => {
      items = [
        { item: { id: '1', name: 'Exact match' }, embedding: [1, 0, 0] },
        { item: { id: '2', name: 'Similar' }, embedding: [0.9, 0.1, 0] },
        { item: { id: '3', name: 'Orthogonal' }, embedding: [0, 1, 0] },
        { item: { id: '4', name: 'Opposite' }, embedding: [-1, 0, 0] },
        { item: { id: '5', name: 'Somewhat similar' }, embedding: [0.7, 0.7, 0] },
      ];
    });

    it('should return top K most similar items', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, items, 3);

      expect(result).toHaveLength(3);
      expect(result[0].item.id).toBe('1'); // Exact match
      expect(result[0].score).toBeCloseTo(1, 10);
    });

    it('should sort results by similarity score descending', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, items, 5);

      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
      }
    });

    it('should handle k larger than items length', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, items, 10);

      // Note: items with score < 0 are filtered out, and 'opposite' has score = -1
      // so only 4 items with score >= 0 are returned
      expect(result.length).toBeLessThanOrEqual(5);
      expect(result.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle k = 1', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, items, 1);

      expect(result).toHaveLength(1);
      expect(result[0].item.id).toBe('1');
    });

    it('should handle empty items array', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, [], 5);

      expect(result).toHaveLength(0);
    });

    it('should throw error for invalid query embedding', () => {
      // The error is thrown when trying to access .length on null/undefined
      expect(() => findTopK(null as any, items, 3)).toThrow();
      expect(() => findTopK(undefined as any, items, 3)).toThrow();
    });

    it('should throw error for invalid items array', () => {
      const queryEmbedding = [1, 0, 0];
      // The error is thrown when trying to map over null/undefined
      expect(() => findTopK(queryEmbedding, null as any, 3)).toThrow();
      expect(() => findTopK(queryEmbedding, undefined as any, 3)).toThrow();
    });

    it('should handle items with mismatched embedding dimensions gracefully', () => {
      const badItems = [
        { item: { id: '1', name: 'Good' }, embedding: [1, 0, 0] },
        { item: { id: '2', name: 'Bad' }, embedding: [1, 0] }, // Wrong dimension
        { item: { id: '3', name: 'Good too' }, embedding: [0.5, 0.5, 0] },
      ];

      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, badItems, 5);

      // Should filter out the bad item and return valid ones
      expect(result.length).toBe(2);
      expect(result.every(r => r.score >= 0)).toBe(true);
    });

    it('should return items with their correct scores', () => {
      const queryEmbedding = [1, 0, 0];
      const result = findTopK(queryEmbedding, items, 2);

      expect(result[0].item.name).toBe('Exact match');
      expect(result[0].score).toBeCloseTo(1, 10);

      expect(result[1].item.name).toBe('Similar');
      expect(result[1].score).toBeGreaterThan(0.9);
    });

    it('should work with high-dimensional embeddings', () => {
      const dim = 1536;
      const highDimItems = [
        { item: { id: '1', name: 'Match' }, embedding: Array(dim).fill(1 / Math.sqrt(dim)) },
        { item: { id: '2', name: 'Different' }, embedding: Array(dim).fill(0).map((_, i) => i % 2 === 0 ? 1 / Math.sqrt(dim / 2) : 0) },
      ];

      const query = Array(dim).fill(1 / Math.sqrt(dim));
      const result = findTopK(query, highDimItems, 2);

      expect(result).toHaveLength(2);
      expect(result[0].item.id).toBe('1');
      expect(result[0].score).toBeCloseTo(1, 5);
    });
  });
});
