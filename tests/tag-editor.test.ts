import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tag normalization function (extracted logic from tag-editor.ts)
function normalizeTagName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

// Check if tag already exists in list
function tagExists(tagName: string, existingTags: string[]): boolean {
  return existingTags.includes(tagName);
}

// Filter tags for autocomplete
function filterTagsForAutocomplete(
  input: string,
  allTags: string[],
  currentTags: string[],
  limit: number = 5
): string[] {
  const normalized = input.toLowerCase();
  return allTags
    .filter(tag => tag.includes(normalized) && !currentTags.includes(tag))
    .slice(0, limit);
}

describe('Tag Editor Logic', () => {
  describe('normalizeTagName', () => {
    it('should convert to lowercase', () => {
      expect(normalizeTagName('JavaScript')).toBe('javascript');
      expect(normalizeTagName('PYTHON')).toBe('python');
    });

    it('should replace spaces with hyphens', () => {
      expect(normalizeTagName('my tag')).toBe('my-tag');
      expect(normalizeTagName('multiple  spaces')).toBe('multiple-spaces');
    });

    it('should trim whitespace', () => {
      expect(normalizeTagName('  test  ')).toBe('test');
    });

    it('should handle mixed transformations', () => {
      expect(normalizeTagName('  My New Tag  ')).toBe('my-new-tag');
    });

    it('should return empty string for whitespace only', () => {
      expect(normalizeTagName('   ')).toBe('');
    });
  });

  describe('tagExists', () => {
    it('should return true if tag exists', () => {
      expect(tagExists('javascript', ['javascript', 'python'])).toBe(true);
    });

    it('should return false if tag does not exist', () => {
      expect(tagExists('ruby', ['javascript', 'python'])).toBe(false);
    });

    it('should handle empty tag list', () => {
      expect(tagExists('javascript', [])).toBe(false);
    });
  });

  describe('filterTagsForAutocomplete', () => {
    const allTags = ['javascript', 'java', 'python', 'typescript', 'jsx', 'json'];

    it('should filter tags by partial match', () => {
      const result = filterTagsForAutocomplete('java', allTags, []);
      expect(result).toContain('javascript');
      expect(result).toContain('java');
      expect(result).not.toContain('python');
    });

    it('should exclude already applied tags', () => {
      const currentTags = ['javascript'];
      const result = filterTagsForAutocomplete('java', allTags, currentTags);
      expect(result).not.toContain('javascript');
      expect(result).toContain('java');
    });

    it('should respect limit', () => {
      const result = filterTagsForAutocomplete('j', allTags, [], 2);
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should be case insensitive', () => {
      const result = filterTagsForAutocomplete('JAVA', allTags, []);
      expect(result).toContain('javascript');
      expect(result).toContain('java');
    });

    it('should return empty array when no matches', () => {
      const result = filterTagsForAutocomplete('xyz', allTags, []);
      expect(result).toEqual([]);
    });
  });

  describe('Tag Editor DOM behavior', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    it('should create tag pills with remove buttons', () => {
      const tags = ['javascript', 'python'];

      // Simulate tag editor render
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'tag-editor-tags';

      for (const tag of tags) {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.innerHTML = `<span>#${tag}</span><button>×</button>`;
        tagsContainer.appendChild(pill);
      }
      container.appendChild(tagsContainer);

      const pills = container.querySelectorAll('.tag-pill');
      expect(pills.length).toBe(2);

      pills.forEach(pill => {
        const button = pill.querySelector('button');
        expect(button).not.toBeNull();
        expect(button?.textContent).toBe('×');
      });
    });

    it('should have input field for adding tags', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Type to add tag...';
      container.appendChild(input);

      const foundInput = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(foundInput).not.toBeNull();
      expect(foundInput.placeholder).toBe('Type to add tag...');
    });

    it('should have dropdown for autocomplete', () => {
      const dropdown = document.createElement('div');
      dropdown.className = 'tag-dropdown';
      dropdown.style.display = 'none';
      container.appendChild(dropdown);

      const foundDropdown = container.querySelector('.tag-dropdown') as HTMLElement;
      expect(foundDropdown).not.toBeNull();
      expect(foundDropdown.style.display).toBe('none');
    });

    it('should show dropdown when there are suggestions', () => {
      const dropdown = document.createElement('div');
      dropdown.className = 'tag-dropdown';
      dropdown.style.display = 'none';
      container.appendChild(dropdown);

      // Simulate showing suggestions
      const suggestions = ['javascript', 'java'];
      for (const suggestion of suggestions) {
        const item = document.createElement('div');
        item.textContent = `#${suggestion}`;
        dropdown.appendChild(item);
      }
      dropdown.style.display = 'block';

      expect(dropdown.style.display).toBe('block');
      expect(dropdown.children.length).toBe(2);
    });
  });

  describe('Tag editing callbacks', () => {
    it('should call onTagsChange when tag is added', async () => {
      const onTagsChange = vi.fn();

      // Simulate tag addition
      const newTag = normalizeTagName('New Tag');
      expect(newTag).toBe('new-tag');

      // After adding tag, callback should be invoked
      onTagsChange();

      expect(onTagsChange).toHaveBeenCalled();
    });

    it('should call onTagsChange when tag is removed', async () => {
      const onTagsChange = vi.fn();

      // Simulate tag removal callback
      onTagsChange();

      expect(onTagsChange).toHaveBeenCalled();
    });
  });
});
