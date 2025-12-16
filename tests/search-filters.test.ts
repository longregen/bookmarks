import { describe, it, expect } from 'vitest';

/**
 * Test search filtering logic without database dependency
 * Tests tag filtering, status filtering, and select-all behavior
 */

interface MockBookmark {
  id: string;
  status: 'complete' | 'pending' | 'processing' | 'error';
}

interface MockBookmarkTag {
  bookmarkId: string;
  tagName: string;
}

// Filter bookmarks by tags (OR logic - matches any of the selected tags)
function filterByTags(
  bookmarks: MockBookmark[],
  tags: MockBookmarkTag[],
  selectedTags: Set<string>
): MockBookmark[] {
  if (selectedTags.size === 0) return bookmarks; // Select All

  return bookmarks.filter(bookmark => {
    const bookmarkTags = tags.filter(t => t.bookmarkId === bookmark.id);
    return bookmarkTags.some(t => selectedTags.has(t.tagName));
  });
}

// Filter bookmarks by status
function filterByStatus(
  bookmarks: MockBookmark[],
  selectedStatuses: Set<string>
): MockBookmark[] {
  return bookmarks.filter(bookmark => selectedStatuses.has(bookmark.status));
}

// Get all unique tags sorted alphabetically
function getAllTags(tags: MockBookmarkTag[]): string[] {
  return [...new Set(tags.map(t => t.tagName))].sort();
}

// Check if Select All should be checked for tags
function isTagSelectAllChecked(selectedTags: Set<string>): boolean {
  return selectedTags.size === 0;
}

// Check if Select All should be checked for statuses
function isStatusSelectAllChecked(selectedStatuses: Set<string>): boolean {
  return selectedStatuses.size === 4; // all 4 statuses
}

describe('Search Filters Logic', () => {
  const bookmarks: MockBookmark[] = [
    { id: 'b1', status: 'complete' },
    { id: 'b2', status: 'complete' },
    { id: 'b3', status: 'pending' },
    { id: 'b4', status: 'error' },
    { id: 'b5', status: 'processing' },
  ];

  const tags: MockBookmarkTag[] = [
    { bookmarkId: 'b1', tagName: 'javascript' },
    { bookmarkId: 'b1', tagName: 'tutorial' },
    { bookmarkId: 'b2', tagName: 'python' },
    { bookmarkId: 'b3', tagName: 'javascript' },
    { bookmarkId: 'b4', tagName: 'tutorial' },
    // b5 has no tags
  ];

  describe('filterByTags', () => {
    it('should return all bookmarks when no tags are selected (Select All)', () => {
      const result = filterByTags(bookmarks, tags, new Set());
      expect(result.length).toBe(5);
    });

    it('should filter by a single tag', () => {
      const result = filterByTags(bookmarks, tags, new Set(['javascript']));
      expect(result.length).toBe(2);
      expect(result.map(b => b.id)).toContain('b1');
      expect(result.map(b => b.id)).toContain('b3');
    });

    it('should filter by multiple tags (OR logic)', () => {
      const result = filterByTags(bookmarks, tags, new Set(['javascript', 'python']));
      expect(result.length).toBe(3);
      expect(result.map(b => b.id)).toContain('b1');
      expect(result.map(b => b.id)).toContain('b2');
      expect(result.map(b => b.id)).toContain('b3');
    });

    it('should return empty when filtering by non-existent tag', () => {
      const result = filterByTags(bookmarks, tags, new Set(['nonexistent']));
      expect(result.length).toBe(0);
    });

    it('should not include bookmarks without tags when filtering', () => {
      const result = filterByTags(bookmarks, tags, new Set(['javascript']));
      expect(result.map(b => b.id)).not.toContain('b5');
    });
  });

  describe('filterByStatus', () => {
    it('should filter by a single status', () => {
      const result = filterByStatus(bookmarks, new Set(['complete']));
      expect(result.length).toBe(2);
      expect(result.every(b => b.status === 'complete')).toBe(true);
    });

    it('should filter by multiple statuses', () => {
      const result = filterByStatus(bookmarks, new Set(['complete', 'pending']));
      expect(result.length).toBe(3);
    });

    it('should return all when all statuses are selected', () => {
      const result = filterByStatus(bookmarks, new Set(['complete', 'pending', 'processing', 'error']));
      expect(result.length).toBe(5);
    });

    it('should exclude bookmarks not matching status', () => {
      const result = filterByStatus(bookmarks, new Set(['error']));
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('b4');
    });
  });

  describe('Combined filtering', () => {
    it('should filter by both tag and status', () => {
      // First filter by tag
      const tagFiltered = filterByTags(bookmarks, tags, new Set(['javascript']));
      // Then filter by status
      const result = filterByStatus(tagFiltered, new Set(['complete']));

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('b1');
    });

    it('should return empty when filters do not overlap', () => {
      // Filter by tag that only b1 and b3 have
      const tagFiltered = filterByTags(bookmarks, tags, new Set(['javascript']));
      // But only look for error status (b4)
      const result = filterByStatus(tagFiltered, new Set(['error']));

      expect(result.length).toBe(0);
    });
  });

  describe('getAllTags', () => {
    it('should return unique tags sorted alphabetically', () => {
      const result = getAllTags(tags);
      expect(result).toEqual(['javascript', 'python', 'tutorial']);
    });

    it('should return empty array when no tags', () => {
      const result = getAllTags([]);
      expect(result).toEqual([]);
    });

    it('should handle duplicate tag names from different bookmarks', () => {
      const duplicateTags: MockBookmarkTag[] = [
        { bookmarkId: 'b1', tagName: 'test' },
        { bookmarkId: 'b2', tagName: 'test' },
        { bookmarkId: 'b3', tagName: 'test' },
      ];
      const result = getAllTags(duplicateTags);
      expect(result).toEqual(['test']);
    });
  });

  describe('Select All behavior', () => {
    describe('Tags Select All', () => {
      it('should be checked when no tags are selected', () => {
        expect(isTagSelectAllChecked(new Set())).toBe(true);
      });

      it('should be unchecked when any tag is selected', () => {
        expect(isTagSelectAllChecked(new Set(['javascript']))).toBe(false);
      });

      it('should be unchecked when multiple tags are selected', () => {
        expect(isTagSelectAllChecked(new Set(['javascript', 'python']))).toBe(false);
      });
    });

    describe('Status Select All', () => {
      it('should be checked when all 4 statuses are selected', () => {
        const allStatuses = new Set(['complete', 'pending', 'processing', 'error']);
        expect(isStatusSelectAllChecked(allStatuses)).toBe(true);
      });

      it('should be unchecked when not all statuses are selected', () => {
        expect(isStatusSelectAllChecked(new Set(['complete', 'pending']))).toBe(false);
      });

      it('should be unchecked when only one status is selected', () => {
        expect(isStatusSelectAllChecked(new Set(['complete']))).toBe(false);
      });

      it('should be unchecked when no statuses are selected', () => {
        expect(isStatusSelectAllChecked(new Set())).toBe(false);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle bookmark with multiple tags matching selection', () => {
      // b1 has both 'javascript' and 'tutorial'
      const result = filterByTags(bookmarks, tags, new Set(['javascript', 'tutorial']));
      // b1 should only appear once
      const b1Count = result.filter(b => b.id === 'b1').length;
      expect(b1Count).toBe(1);
    });

    it('should correctly filter empty bookmark list', () => {
      const result = filterByTags([], tags, new Set(['javascript']));
      expect(result).toEqual([]);
    });

    it('should correctly filter with empty tag list', () => {
      const result = filterByTags(bookmarks, [], new Set(['javascript']));
      expect(result).toEqual([]);
    });
  });
});
