import { describe, it, expect } from 'vitest';

/**
 * Test search filtering logic without database dependency
 * Tests tag filtering and clear selection behavior
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

// Get all unique tags sorted alphabetically
function getAllTags(tags: MockBookmarkTag[]): string[] {
  return [...new Set(tags.map(t => t.tagName))].sort();
}

// Check if Clear selection button should be shown for tags
function shouldShowClearSelection(selectedTags: Set<string>): boolean {
  return selectedTags.size > 0;
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
    it('should return all bookmarks when no tags are selected (default behavior)', () => {
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

  describe('Clear selection behavior', () => {
    it('should not show clear button when no tags are selected', () => {
      expect(shouldShowClearSelection(new Set())).toBe(false);
    });

    it('should show clear button when any tag is selected', () => {
      expect(shouldShowClearSelection(new Set(['javascript']))).toBe(true);
    });

    it('should show clear button when multiple tags are selected', () => {
      expect(shouldShowClearSelection(new Set(['javascript', 'python']))).toBe(true);
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
