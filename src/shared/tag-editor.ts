/**
 * Tag Editor Component
 *
 * Provides an interactive tag management interface with:
 * - Display existing tags as removable badges
 * - Input field for typing/filtering tags
 * - Autocomplete dropdown with existing tags
 * - Tag creation and normalization
 * - Backspace to remove last tag when input is empty
 */

import { db, BookmarkTag } from '../db/schema.js';
import { createElement } from '../lib/dom.js';

export interface TagEditorOptions {
  bookmarkId: string;
  initialTags: string[];
  allAvailableTags: string[];  // All tags across all bookmarks for autocomplete
  onChange: (tags: string[]) => void;
}

interface TagEditorState {
  tags: string[];
  inputValue: string;
  showAutocomplete: boolean;
  selectedSuggestionIndex: number;
}

/**
 * Create an interactive tag editor component
 */
export function createTagEditor(options: TagEditorOptions): HTMLElement {
  const state: TagEditorState = {
    tags: [...options.initialTags],
    inputValue: '',
    showAutocomplete: false,
    selectedSuggestionIndex: -1
  };

  // Main container
  const container = createElement('div', { className: 'tag-editor' });

  // Tags display area
  const tagsContainer = createElement('div', { className: 'tag-editor__tags' });

  // Input field
  const input = createElement('input', {
    className: 'tag-editor__input',
    attributes: {
      type: 'text',
      placeholder: 'type to add...',
      autocomplete: 'off'
    }
  }) as HTMLInputElement;

  // Autocomplete dropdown
  const autocompleteDropdown = createElement('div', {
    className: 'tag-editor__autocomplete hidden'
  });

  // Render tags
  const renderTags = () => {
    tagsContainer.innerHTML = '';

    state.tags.forEach((tag, index) => {
      const tagBadge = createElement('div', {
        className: 'tag-editor__badge'
      });

      const tagText = createElement('span', {
        className: 'tag-editor__badge-text',
        textContent: `#${tag}`
      });

      const removeBtn = createElement('button', {
        className: 'tag-editor__badge-remove',
        textContent: '×',
        title: 'Remove tag',
        attributes: { type: 'button' }
      }) as HTMLButtonElement;

      removeBtn.addEventListener('click', () => {
        removeTag(index);
      });

      tagBadge.appendChild(tagText);
      tagBadge.appendChild(removeBtn);
      tagsContainer.appendChild(tagBadge);
    });

    tagsContainer.appendChild(input);
  };

  // Remove a tag
  const removeTag = async (index: number) => {
    const tagToRemove = state.tags[index];
    state.tags.splice(index, 1);
    renderTags();

    // Update database
    await removeTagFromBookmark(options.bookmarkId, tagToRemove);

    // Notify parent
    options.onChange(state.tags);
  };

  // Get filtered suggestions
  const getFilteredSuggestions = (): string[] => {
    const normalizedInput = normalizeTagName(state.inputValue);
    if (!normalizedInput) return [];

    return options.allAvailableTags
      .filter(tag =>
        tag.includes(normalizedInput) &&
        !state.tags.includes(tag)
      )
      .sort()
      .slice(0, 10); // Limit to 10 suggestions
  };

  // Render autocomplete dropdown
  const renderAutocomplete = () => {
    const suggestions = getFilteredSuggestions();
    const normalizedInput = normalizeTagName(state.inputValue);

    autocompleteDropdown.innerHTML = '';

    if (suggestions.length === 0 && normalizedInput) {
      // Show "Create new tag" option
      const createOption = createElement('div', {
        className: 'tag-editor__autocomplete-item tag-editor__autocomplete-item--create',
        textContent: `Create "${normalizedInput}"`
      });

      createOption.addEventListener('click', () => {
        addTag(normalizedInput);
      });

      autocompleteDropdown.appendChild(createOption);
      autocompleteDropdown.classList.remove('hidden');
      state.showAutocomplete = true;
    } else if (suggestions.length > 0) {
      // Show existing tag suggestions
      suggestions.forEach((tag, index) => {
        const item = createElement('div', {
          className: 'tag-editor__autocomplete-item',
          textContent: `#${tag}`
        });

        if (index === state.selectedSuggestionIndex) {
          item.classList.add('tag-editor__autocomplete-item--selected');
        }

        item.addEventListener('click', () => {
          addTag(tag);
        });

        autocompleteDropdown.appendChild(item);
      });

      // Add separator and "Create new" option if input doesn't match exactly
      if (normalizedInput && !suggestions.includes(normalizedInput)) {
        const separator = createElement('div', {
          className: 'tag-editor__autocomplete-separator'
        });
        autocompleteDropdown.appendChild(separator);

        const createOption = createElement('div', {
          className: 'tag-editor__autocomplete-item tag-editor__autocomplete-item--create',
          textContent: `Create "${normalizedInput}"`
        });

        createOption.addEventListener('click', () => {
          addTag(normalizedInput);
        });

        autocompleteDropdown.appendChild(createOption);
      }

      autocompleteDropdown.classList.remove('hidden');
      state.showAutocomplete = true;
    } else {
      autocompleteDropdown.classList.add('hidden');
      state.showAutocomplete = false;
    }
  };

  // Add a tag
  const addTag = async (tagName: string) => {
    const normalized = normalizeTagName(tagName);

    if (!normalized) return;
    if (state.tags.includes(normalized)) {
      // Duplicate, just clear input
      state.inputValue = '';
      input.value = '';
      autocompleteDropdown.classList.add('hidden');
      state.showAutocomplete = false;
      return;
    }

    state.tags.push(normalized);
    state.inputValue = '';
    input.value = '';
    state.selectedSuggestionIndex = -1;

    renderTags();
    autocompleteDropdown.classList.add('hidden');
    state.showAutocomplete = false;

    // Update database
    await addTagToBookmark(options.bookmarkId, normalized);

    // Notify parent
    options.onChange(state.tags);

    // Focus input
    input.focus();
  };

  // Input event handlers
  input.addEventListener('input', (e) => {
    state.inputValue = (e.target as HTMLInputElement).value;
    state.selectedSuggestionIndex = -1;
    renderAutocomplete();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      if (state.showAutocomplete) {
        const suggestions = getFilteredSuggestions();

        if (state.selectedSuggestionIndex >= 0 && state.selectedSuggestionIndex < suggestions.length) {
          // Add selected suggestion
          addTag(suggestions[state.selectedSuggestionIndex]);
        } else {
          // Add/create from input
          const normalized = normalizeTagName(state.inputValue);
          if (normalized) {
            addTag(normalized);
          }
        }
      } else if (state.inputValue.trim()) {
        // Create new tag
        const normalized = normalizeTagName(state.inputValue);
        if (normalized) {
          addTag(normalized);
        }
      }
    } else if (e.key === 'Backspace' && state.inputValue === '') {
      // Remove last tag when backspace on empty input
      if (state.tags.length > 0) {
        removeTag(state.tags.length - 1);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.showAutocomplete) {
        const suggestions = getFilteredSuggestions();
        state.selectedSuggestionIndex = Math.min(
          state.selectedSuggestionIndex + 1,
          suggestions.length - 1
        );
        renderAutocomplete();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.showAutocomplete) {
        state.selectedSuggestionIndex = Math.max(
          state.selectedSuggestionIndex - 1,
          0
        );
        renderAutocomplete();
      }
    } else if (e.key === 'Escape') {
      autocompleteDropdown.classList.add('hidden');
      state.showAutocomplete = false;
      state.selectedSuggestionIndex = -1;
    }
  });

  input.addEventListener('focus', () => {
    if (state.inputValue) {
      renderAutocomplete();
    }
  });

  input.addEventListener('blur', () => {
    // Delay to allow click events on autocomplete items
    setTimeout(() => {
      autocompleteDropdown.classList.add('hidden');
      state.showAutocomplete = false;
      state.selectedSuggestionIndex = -1;
    }, 200);
  });

  // Assemble component
  container.appendChild(tagsContainer);
  container.appendChild(autocompleteDropdown);

  // Initial render
  renderTags();

  return container;
}

/**
 * Get all tags for a specific bookmark
 */
export async function getBookmarkTags(bookmarkId: string): Promise<string[]> {
  const tags = await db.bookmarkTags
    .where('bookmarkId')
    .equals(bookmarkId)
    .toArray();

  return tags.map(t => t.tagName).sort();
}

/**
 * Get all unique tags across all bookmarks
 */
export async function getAllTags(): Promise<string[]> {
  const allTags = await db.bookmarkTags.toArray();
  const uniqueTags = new Set(allTags.map(t => t.tagName));
  return Array.from(uniqueTags).sort();
}

/**
 * Add a tag to a bookmark
 */
export async function addTagToBookmark(bookmarkId: string, tagName: string): Promise<void> {
  const normalized = normalizeTagName(tagName);

  if (!normalized) {
    throw new Error('Invalid tag name');
  }

  // Check if tag already exists
  const existing = await db.bookmarkTags
    .where('[bookmarkId+tagName]')
    .equals([bookmarkId, normalized])
    .first();

  if (existing) {
    return; // Tag already exists, no-op
  }

  const bookmarkTag: BookmarkTag = {
    bookmarkId,
    tagName: normalized,
    addedAt: new Date()
  };

  await db.bookmarkTags.add(bookmarkTag);
}

/**
 * Remove a tag from a bookmark
 */
export async function removeTagFromBookmark(bookmarkId: string, tagName: string): Promise<void> {
  const normalized = normalizeTagName(tagName);

  await db.bookmarkTags
    .where('[bookmarkId+tagName]')
    .equals([bookmarkId, normalized])
    .delete();
}

/**
 * Normalize tag name: lowercase, replace spaces with hyphens, remove invalid chars
 */
export function normalizeTagName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')     // Remove invalid characters
    .replace(/^-+|-+$/g, '')        // Remove leading/trailing hyphens
    .replace(/-{2,}/g, '-');        // Replace multiple hyphens with single
}

/**
 * Inject tag editor styles into the document
 */
export function injectTagEditorStyles(): void {
  const styleId = 'tag-editor-styles';

  // Check if styles already injected
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Tag Editor Component */
    .tag-editor {
      position: relative;
      width: 100%;
    }

    .tag-editor__tags {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border-secondary);
      border-radius: var(--radius-lg);
      background: var(--bg-input);
      min-height: 44px;
      cursor: text;
    }

    .tag-editor__tags:focus-within {
      border-color: var(--border-focus);
      box-shadow: var(--shadow-focus);
    }

    .tag-editor__badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      background: var(--badge-bg);
      color: var(--badge-text);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      font-weight: var(--font-medium);
      transition: all var(--transition-fast);
    }

    .tag-editor__badge:hover {
      background: var(--bg-hover);
    }

    .tag-editor__badge-text {
      user-select: none;
    }

    .tag-editor__badge-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      color: var(--text-tertiary);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      margin: 0;
      transition: color var(--transition-fast);
    }

    .tag-editor__badge-remove:hover {
      color: var(--error-text);
    }

    .tag-editor__input {
      flex: 1;
      min-width: 120px;
      border: none;
      outline: none;
      background: transparent;
      font-size: var(--text-base);
      font-family: inherit;
      color: var(--text-primary);
      padding: 0;
    }

    .tag-editor__input::placeholder {
      color: var(--text-muted);
    }

    .tag-editor__autocomplete {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: var(--space-2);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      max-height: 240px;
      overflow-y: auto;
      z-index: 1000;
    }

    .tag-editor__autocomplete.hidden {
      display: none;
    }

    .tag-editor__autocomplete-item {
      padding: var(--space-3) var(--space-4);
      cursor: pointer;
      font-size: var(--text-base);
      color: var(--text-primary);
      transition: background var(--transition-fast);
      border-bottom: 1px solid var(--border-primary);
    }

    .tag-editor__autocomplete-item:last-child {
      border-bottom: none;
    }

    .tag-editor__autocomplete-item:hover,
    .tag-editor__autocomplete-item--selected {
      background: var(--bg-hover);
    }

    .tag-editor__autocomplete-item--create {
      color: var(--accent-primary);
      font-weight: var(--font-medium);
    }

    .tag-editor__autocomplete-separator {
      height: 1px;
      background: var(--border-secondary);
      margin: var(--space-2) var(--space-4);
    }

    /* Scrollbar styling for autocomplete */
    .tag-editor__autocomplete::-webkit-scrollbar {
      width: 8px;
    }

    .tag-editor__autocomplete::-webkit-scrollbar-track {
      background: var(--bg-tertiary);
      border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    }

    .tag-editor__autocomplete::-webkit-scrollbar-thumb {
      background: var(--border-secondary);
      border-radius: 4px;
    }

    .tag-editor__autocomplete::-webkit-scrollbar-thumb:hover {
      background: var(--text-tertiary);
    }
  `;

  document.head.appendChild(style);
}
