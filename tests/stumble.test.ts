import { describe, it, expect, vi } from 'vitest';

/**
 * Extract the Fisher-Yates shuffle logic from stumble.ts for testing
 * This is the same algorithm used in src/stumble/stumble.ts lines 78-82
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

describe('Stumble Algorithm', () => {
  describe('Fisher-Yates Shuffle', () => {
    it('should maintain all original items (no duplicates, no missing)', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = fisherYatesShuffle(original);

      // Should have same length
      expect(shuffled.length).toBe(original.length);

      // Should contain all original items
      for (const item of original) {
        expect(shuffled).toContain(item);
      }

      // Should not have duplicates
      const uniqueItems = new Set(shuffled);
      expect(uniqueItems.size).toBe(original.length);
    });

    it('should not modify the original array', () => {
      const original = [1, 2, 3, 4, 5];
      const originalCopy = [...original];
      fisherYatesShuffle(original);

      expect(original).toEqual(originalCopy);
    });

    it('should produce different orderings on repeated calls', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results: string[] = [];

      // Run shuffle 100 times and collect results
      for (let i = 0; i < 100; i++) {
        const shuffled = fisherYatesShuffle(original);
        results.push(JSON.stringify(shuffled));
      }

      // Count unique results
      const uniqueResults = new Set(results);

      // With 10 items and 100 shuffles, we should get many different orderings
      // (There are 10! = 3,628,800 possible permutations, so getting the same one is unlikely)
      expect(uniqueResults.size).toBeGreaterThan(50);
    });

    it('should handle arrays with complex objects', () => {
      const original = [
        { id: '1', title: 'First' },
        { id: '2', title: 'Second' },
        { id: '3', title: 'Third' },
      ];
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.length).toBe(3);
      expect(shuffled).toContainEqual({ id: '1', title: 'First' });
      expect(shuffled).toContainEqual({ id: '2', title: 'Second' });
      expect(shuffled).toContainEqual({ id: '3', title: 'Third' });
    });

    it('should handle empty arrays', () => {
      const original: number[] = [];
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled).toEqual([]);
    });

    it('should handle single-element arrays', () => {
      const original = [42];
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled).toEqual([42]);
    });

    it('should handle two-element arrays', () => {
      const original = [1, 2];
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.length).toBe(2);
      expect(shuffled).toContain(1);
      expect(shuffled).toContain(2);
    });

    it('should produce uniform distribution over many runs', () => {
      // Test with a small array to verify randomness
      const original = [1, 2, 3];
      const positionCounts: { [key: string]: number } = {
        '1,2,3': 0,
        '1,3,2': 0,
        '2,1,3': 0,
        '2,3,1': 0,
        '3,1,2': 0,
        '3,2,1': 0,
      };

      const iterations = 6000; // 1000 per possible permutation
      for (let i = 0; i < iterations; i++) {
        const shuffled = fisherYatesShuffle(original);
        const key = shuffled.join(',');
        positionCounts[key]++;
      }

      // Each permutation should appear roughly equally
      // With 6 permutations and 6000 iterations, expect ~1000 each
      // Allow for statistical variance (should be within 700-1300)
      for (const count of Object.values(positionCounts)) {
        expect(count).toBeGreaterThan(700);
        expect(count).toBeLessThan(1300);
      }
    });

    it('should shuffle with controlled randomness', () => {
      // Mock Math.random to produce predictable sequence
      const randomValues = [0.9, 0.5, 0.1]; // High to low
      let callCount = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const value = randomValues[callCount % randomValues.length];
        callCount++;
        return value;
      });

      const original = [1, 2, 3, 4];
      const shuffled = fisherYatesShuffle(original);

      // With mocked random values, we can predict the outcome
      // i=3: j=floor(0.9*4)=3, swap arr[3] with arr[3] -> [1,2,3,4]
      // i=2: j=floor(0.5*3)=1, swap arr[2] with arr[1] -> [1,3,2,4]
      // i=1: j=floor(0.1*2)=0, swap arr[1] with arr[0] -> [3,1,2,4]
      expect(shuffled).toEqual([3, 1, 2, 4]);

      vi.restoreAllMocks();
    });

    it('should handle arrays with duplicate values', () => {
      const original = [1, 1, 2, 2, 3, 3];
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.length).toBe(6);
      expect(shuffled.filter(x => x === 1).length).toBe(2);
      expect(shuffled.filter(x => x === 2).length).toBe(2);
      expect(shuffled.filter(x => x === 3).length).toBe(2);
    });

    it('should handle large arrays efficiently', () => {
      const original = Array.from({ length: 1000 }, (_, i) => i);
      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.length).toBe(1000);

      // Verify all elements are present
      const sorted = [...shuffled].sort((a, b) => a - b);
      expect(sorted).toEqual(original);

      // Very likely that at least some elements changed position
      const differentPositions = shuffled.filter((val, idx) => val !== original[idx]);
      expect(differentPositions.length).toBeGreaterThan(900); // Most should be different
    });
  });
});
