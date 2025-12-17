import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import { validateImportData, type BookmarkExport } from '../src/lib/export';

describe('Export utilities', () => {
  describe('validateImportData', () => {
    it('should return true for valid export data', () => {
      const validData: BookmarkExport = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-1',
            url: 'https://example.com',
            title: 'Test Bookmark',
            html: '<html></html>',
            status: 'complete',
            createdAt: '2024-01-15T12:00:00Z',
            updatedAt: '2024-01-15T12:00:00Z',
            questionsAnswers: [],
          },
        ],
      };

      expect(validateImportData(validData)).toBe(true);
    });

    it('should return false for null', () => {
      expect(validateImportData(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(validateImportData(undefined)).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect(validateImportData('string')).toBe(false);
      expect(validateImportData(123)).toBe(false);
      expect(validateImportData(true)).toBe(false);
      expect(validateImportData([])).toBe(false);
    });

    it('should return false when version is missing', () => {
      const data = {
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 0,
        bookmarks: [],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when version is not a number', () => {
      const data = {
        version: '2',
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 0,
        bookmarks: [],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmarks is missing', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 0,
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmarks is not an array', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 0,
        bookmarks: {},
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when a bookmark is null', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [null],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when a bookmark is not an object', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: ['not an object'],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmark url is missing', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-1',
            title: 'Test Bookmark',
          },
        ],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmark url is not a string', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-1',
            url: 123,
            title: 'Test Bookmark',
          },
        ],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmark title is missing', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-1',
            url: 'https://example.com',
          },
        ],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return false when bookmark title is not a string', () => {
      const data = {
        version: 2,
        exportedAt: '2024-01-15T12:00:00Z',
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-1',
            url: 'https://example.com',
            title: 123,
          },
        ],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should return true for minimal valid bookmark', () => {
      const data = {
        version: 2,
        bookmarks: [
          {
            url: 'https://example.com',
            title: 'Test',
          },
        ],
      };
      expect(validateImportData(data)).toBe(true);
    });

    it('should return true for empty bookmarks array', () => {
      const data = {
        version: 2,
        bookmarks: [],
      };
      expect(validateImportData(data)).toBe(true);
    });

    it('should return true for multiple valid bookmarks', () => {
      const data = {
        version: 2,
        bookmarks: [
          { url: 'https://example1.com', title: 'Test 1' },
          { url: 'https://example2.com', title: 'Test 2' },
          { url: 'https://example3.com', title: 'Test 3' },
        ],
      };
      expect(validateImportData(data)).toBe(true);
    });

    it('should return false if any bookmark in array is invalid', () => {
      const data = {
        version: 2,
        bookmarks: [
          { url: 'https://example1.com', title: 'Valid' },
          { url: 'https://example2.com' }, // Missing title
          { url: 'https://example3.com', title: 'Valid' },
        ],
      };
      expect(validateImportData(data)).toBe(false);
    });

    it('should handle version 1 format', () => {
      const data = {
        version: 1,
        bookmarks: [
          { url: 'https://example.com', title: 'Test' },
        ],
      };
      expect(validateImportData(data)).toBe(true);
    });
  });

  describe('Export format', () => {
    it('should have correct structure for BookmarkExport type', () => {
      const exportData: BookmarkExport = {
        version: 2,
        exportedAt: new Date().toISOString(),
        bookmarkCount: 0,
        bookmarks: [],
      };

      expect(exportData.version).toBe(2);
      expect(typeof exportData.exportedAt).toBe('string');
      expect(exportData.bookmarkCount).toBe(0);
      expect(Array.isArray(exportData.bookmarks)).toBe(true);
    });

    it('should support all bookmark fields in export', () => {
      const exportData: BookmarkExport = {
        version: 2,
        exportedAt: new Date().toISOString(),
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'test-id',
            url: 'https://example.com',
            title: 'Test Bookmark',
            html: '<html><body>Content</body></html>',
            status: 'complete',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            markdown: '# Test Content',
            questionsAnswers: [
              {
                question: 'What is this?',
                answer: 'A test.',
                embeddingQuestion: 'base64encoded...',
                embeddingAnswer: 'base64encoded...',
                embeddingBoth: 'base64encoded...',
              },
            ],
          },
        ],
      };

      expect(exportData.bookmarks[0].markdown).toBe('# Test Content');
      expect(exportData.bookmarks[0].questionsAnswers.length).toBe(1);
    });

    it('should support all bookmark status values', () => {
      const statuses: Array<'pending' | 'processing' | 'complete' | 'error'> = [
        'pending',
        'processing',
        'complete',
        'error',
      ];

      for (const status of statuses) {
        const exportData: BookmarkExport = {
          version: 2,
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [
            {
              id: 'test-id',
              url: 'https://example.com',
              title: 'Test',
              html: '',
              status,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              questionsAnswers: [],
            },
          ],
        };

        expect(validateImportData(exportData)).toBe(true);
      }
    });
  });
});
