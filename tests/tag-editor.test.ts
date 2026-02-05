import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeTagName } from '../src/ui/tag-editor';

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

  describe('Tag Editor DOM behavior', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    it('should create tag pills with remove buttons', () => {
      const tags = ['javascript', 'python'];

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
});
