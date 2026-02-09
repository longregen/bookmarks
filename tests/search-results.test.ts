import { describe, it, expect } from 'vitest';

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function findBestQA<T extends { score: number }>(qaResults: T[]): T {
  return qaResults.reduce((best, curr) => curr.score > best.score ? curr : best);
}

describe('Search Result Helpers', () => {
  describe('extractHostname', () => {
    it('should extract hostname from valid URL', () => {
      expect(extractHostname('https://example.com/path')).toBe('example.com');
    });

    it('should extract hostname from URL with port', () => {
      expect(extractHostname('https://example.com:8080/path')).toBe('example.com');
    });

    it('should extract hostname from URL with subdomain', () => {
      expect(extractHostname('https://docs.example.com/page')).toBe('docs.example.com');
    });

    it('should fall back to raw string for malformed URL', () => {
      expect(extractHostname('not-a-url')).toBe('not-a-url');
    });

    it('should fall back to raw string for empty string', () => {
      expect(extractHostname('')).toBe('');
    });

    it('should fall back to raw string for protocol-only', () => {
      expect(extractHostname('://broken')).toBe('://broken');
    });

    it('should handle data URIs gracefully', () => {
      const dataUri = 'data:text/html,<h1>test</h1>';
      expect(extractHostname(dataUri)).toBe('');
    });
  });

  describe('findBestQA', () => {
    it('should return the single item when only one exists', () => {
      const results = [{ qa: 'only', score: 0.5 }];
      expect(findBestQA(results)).toEqual({ qa: 'only', score: 0.5 });
    });

    it('should return highest scored item when first has highest score', () => {
      const results = [
        { qa: 'first', score: 0.9 },
        { qa: 'second', score: 0.7 },
        { qa: 'third', score: 0.5 },
      ];
      expect(findBestQA(results).qa).toBe('first');
    });

    it('should return highest scored item when last has highest score', () => {
      const results = [
        { qa: 'first', score: 0.5 },
        { qa: 'second', score: 0.7 },
        { qa: 'third', score: 0.9 },
      ];
      expect(findBestQA(results).qa).toBe('third');
    });

    it('should return highest scored item when middle has highest score', () => {
      const results = [
        { qa: 'first', score: 0.5 },
        { qa: 'second', score: 0.9 },
        { qa: 'third', score: 0.7 },
      ];
      expect(findBestQA(results).qa).toBe('second');
    });

    it('should return first item when all scores are equal', () => {
      const results = [
        { qa: 'first', score: 0.5 },
        { qa: 'second', score: 0.5 },
        { qa: 'third', score: 0.5 },
      ];
      expect(findBestQA(results).qa).toBe('first');
    });

    it('should handle negative scores', () => {
      const results = [
        { qa: 'first', score: -0.5 },
        { qa: 'second', score: -0.1 },
        { qa: 'third', score: -0.9 },
      ];
      expect(findBestQA(results).qa).toBe('second');
    });
  });
});
