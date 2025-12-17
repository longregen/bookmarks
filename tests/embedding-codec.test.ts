import { describe, it, expect } from 'vitest';
import {
  encodeEmbedding,
  decodeEmbedding,
  maxQuantizationError,
  compressionRatio,
  isEncodedEmbedding,
} from '../src/lib/embedding-codec';

describe('Embedding Codec', () => {
  describe('encodeEmbedding and decodeEmbedding', () => {
    it('should encode and decode a simple embedding', () => {
      const original = [0.5, -0.5, 0, 1, -1];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded.length).toBe(original.length);

      const maxError = maxQuantizationError();
      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(decoded[i] - original[i])).toBeLessThanOrEqual(maxError);
      }
    });

    it('should preserve edge values -1, 0, and 1', () => {
      const original = [-1, 0, 1];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded[0]).toBe(-1);
      expect(decoded[1]).toBe(0);
      expect(decoded[2]).toBeCloseTo(1, 4);
    });

    it('should handle typical OpenAI embedding dimensions (1536)', () => {
      const original: number[] = [];
      for (let i = 0; i < 1536; i++) {
        original.push(Math.random() * 2 - 1);
      }

      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded.length).toBe(1536);

      const maxError = maxQuantizationError();
      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(decoded[i] - original[i])).toBeLessThanOrEqual(maxError);
      }
    });

    it('should handle larger embeddings (3072 dimensions)', () => {
      const original: number[] = [];
      for (let i = 0; i < 3072; i++) {
        original.push(Math.random() * 2 - 1);
      }

      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded.length).toBe(3072);

      const maxError = maxQuantizationError();
      let maxObservedError = 0;
      for (let i = 0; i < original.length; i++) {
        const error = Math.abs(decoded[i] - original[i]);
        maxObservedError = Math.max(maxObservedError, error);
        expect(error).toBeLessThanOrEqual(maxError);
      }

      console.log(`Max observed error for 3072-dim embedding: ${maxObservedError.toExponential(3)}`);
    });

    it('should clamp values outside [-1, 1]', () => {
      const original = [-2, -1.5, 1.5, 2];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded[0]).toBe(-1);
      expect(decoded[1]).toBe(-1);
      expect(decoded[2]).toBeCloseTo(1, 4);
      expect(decoded[3]).toBeCloseTo(1, 4);
    });

    it('should produce a valid base64 string', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];
      const encoded = encodeEmbedding(original);

      expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);

      expect(() => decodeEmbedding(encoded)).not.toThrow();
    });

    it('should handle empty embedding', () => {
      const original: number[] = [];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded.length).toBe(0);
    });

    it('should handle single value embedding', () => {
      const original = [0.12345];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      expect(decoded.length).toBe(1);
      expect(Math.abs(decoded[0] - original[0])).toBeLessThanOrEqual(maxQuantizationError());
    });
  });

  describe('quantization precision', () => {
    it('should have maximum error of approximately 1/32767', () => {
      const expectedMaxError = 1 / 32767;
      expect(maxQuantizationError()).toBeCloseTo(expectedMaxError, 10);
    });

    it('should maintain precision across many roundtrips', () => {
      const original = [0.123456789];
      let value = original;

      for (let i = 0; i < 100; i++) {
        const encoded = encodeEmbedding(value);
        value = decodeEmbedding(encoded);
      }

      expect(Math.abs(value[0] - original[0])).toBeLessThanOrEqual(maxQuantizationError());
    });

    it('should preserve similarity calculations with sufficient precision', () => {
      const a = [0.5, 0.3, -0.2, 0.8, -0.6];
      const b = [0.4, 0.2, -0.3, 0.7, -0.5];

      const cosineSim = (x: number[], y: number[]) => {
        let dot = 0, normX = 0, normY = 0;
        for (let i = 0; i < x.length; i++) {
          dot += x[i] * y[i];
          normX += x[i] * x[i];
          normY += y[i] * y[i];
        }
        return dot / (Math.sqrt(normX) * Math.sqrt(normY));
      };

      const originalSimilarity = cosineSim(a, b);

      const aEncoded = decodeEmbedding(encodeEmbedding(a));
      const bEncoded = decodeEmbedding(encodeEmbedding(b));
      const encodedSimilarity = cosineSim(aEncoded, bEncoded);

      expect(encodedSimilarity).toBeCloseTo(originalSimilarity, 4);
    });
  });

  describe('compressionRatio', () => {
    it('should achieve significant compression for realistic embeddings', () => {
      const embedding: number[] = [];
      for (let i = 0; i < 1536; i++) {
        embedding.push(Math.random() * 2 - 1);
      }

      const { jsonSize, encodedSize, ratio } = compressionRatio(embedding);

      console.log(`1536-dim embedding:`);
      console.log(`  JSON size: ${jsonSize} bytes`);
      console.log(`  Encoded size: ${encodedSize} bytes`);
      console.log(`  Compression ratio: ${ratio.toFixed(2)}x`);

      expect(ratio).toBeGreaterThan(3);

      expect(encodedSize).toBeLessThan(5000);

      expect(jsonSize).toBeGreaterThan(15000);
    });

    it('should show size savings for multiple embeddings', () => {
      const numQAPairs = 10;
      const embeddingsPerQA = 3;
      const embeddingDim = 1536;

      let totalJsonSize = 0;
      let totalEncodedSize = 0;

      for (let i = 0; i < numQAPairs * embeddingsPerQA; i++) {
        const embedding: number[] = [];
        for (let j = 0; j < embeddingDim; j++) {
          embedding.push(Math.random() * 2 - 1);
        }
        const { jsonSize, encodedSize } = compressionRatio(embedding);
        totalJsonSize += jsonSize;
        totalEncodedSize += encodedSize;
      }

      console.log(`\nTotal for ${numQAPairs} Q&A pairs (${numQAPairs * embeddingsPerQA} embeddings):`);
      console.log(`  JSON size: ${(totalJsonSize / 1024).toFixed(1)} KB`);
      console.log(`  Encoded size: ${(totalEncodedSize / 1024).toFixed(1)} KB`);
      console.log(`  Savings: ${((totalJsonSize - totalEncodedSize) / 1024).toFixed(1)} KB`);

      expect(totalJsonSize / totalEncodedSize).toBeGreaterThan(3);
    });
  });

  describe('isEncodedEmbedding', () => {
    it('should identify valid encoded embeddings', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const encoded = encodeEmbedding(embedding);

      expect(isEncodedEmbedding(encoded)).toBe(true);
    });

    it('should reject number arrays', () => {
      expect(isEncodedEmbedding([0.1, 0.2, 0.3])).toBe(false);
    });

    it('should reject non-strings', () => {
      expect(isEncodedEmbedding(null)).toBe(false);
      expect(isEncodedEmbedding(undefined)).toBe(false);
      expect(isEncodedEmbedding(123)).toBe(false);
      expect(isEncodedEmbedding({})).toBe(false);
    });

    it('should reject strings that are too short', () => {
      expect(isEncodedEmbedding('')).toBe(false);
      expect(isEncodedEmbedding('AB')).toBe(false);
    });

    it('should reject strings with invalid base64 characters', () => {
      expect(isEncodedEmbedding('ABC!')).toBe(false);
      expect(isEncodedEmbedding('ABC@DEF')).toBe(false);
      expect(isEncodedEmbedding('ABC DEF')).toBe(false);
    });

    it('should accept valid base64 with padding', () => {
      expect(isEncodedEmbedding('AAAA')).toBe(true);
      expect(isEncodedEmbedding('AAAA==')).toBe(true);
      expect(isEncodedEmbedding('AAAABB==')).toBe(true);
    });
  });

  describe('edge cases and robustness', () => {
    it('should handle very small values', () => {
      const original = [0.00001, -0.00001, 0.000001];
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(decoded[i] - original[i])).toBeLessThanOrEqual(maxQuantizationError());
      }
    });

    it('should handle alternating positive/negative values', () => {
      const original: number[] = [];
      for (let i = 0; i < 100; i++) {
        original.push(i % 2 === 0 ? 0.5 : -0.5);
      }

      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(decoded[i] - original[i])).toBeLessThanOrEqual(maxQuantizationError());
      }
    });

    it('should handle all zeros', () => {
      const original = new Array(100).fill(0);
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      for (const value of decoded) {
        expect(value).toBe(0);
      }
    });

    it('should handle all ones', () => {
      const original = new Array(100).fill(1);
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      for (const value of decoded) {
        expect(value).toBeCloseTo(1, 4);
      }
    });

    it('should handle all negative ones', () => {
      const original = new Array(100).fill(-1);
      const encoded = encodeEmbedding(original);
      const decoded = decodeEmbedding(encoded);

      for (const value of decoded) {
        expect(value).toBe(-1);
      }
    });
  });

  describe('format stability', () => {
    it('should produce consistent encoding for the same input', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];

      const encoded1 = encodeEmbedding(original);
      const encoded2 = encodeEmbedding(original);

      expect(encoded1).toBe(encoded2);
    });

    it('should produce deterministic output for known input', () => {
      const original = [0, 0.5, -0.5, 1, -1];
      const encoded = encodeEmbedding(original);

      expect(encoded.length).toBeGreaterThan(0);

      const decoded = decodeEmbedding(encoded);
      expect(decoded[0]).toBe(0);
      expect(Math.abs(decoded[1] - 0.5)).toBeLessThanOrEqual(maxQuantizationError());
      expect(Math.abs(decoded[2] - (-0.5))).toBeLessThanOrEqual(maxQuantizationError());
      expect(decoded[3]).toBeCloseTo(1, 4);
      expect(decoded[4]).toBe(-1);
    });
  });
});
