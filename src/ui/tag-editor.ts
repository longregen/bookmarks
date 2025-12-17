import { db, type BookmarkTag } from '../db/schema';
import { createElement } from './dom';
import { broadcastEvent } from '../lib/events';

export interface TagEditorOptions {
  bookmarkId: string;
  container: HTMLElement;
  onTagsChange?: () => void;
}

function normalizeTagName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

export async function createTagEditor(options: TagEditorOptions): Promise<void> {
  const { bookmarkId, container, onTagsChange } = options;

  const containerWithCleanup = container as HTMLElement & { _cleanup?: () => void };
  if (containerWithCleanup._cleanup) {
    containerWithCleanup._cleanup();
  }

  const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).toArray();
  const allTags = await getAllTags();

  container.innerHTML = '';

  const section = createElement('div', { className: 'tag-editor' });
  section.appendChild(createElement('h3', {
    textContent: 'TAGS'
  }));

  const tagsContainer = createElement('div', {
    className: 'tag-editor-tags'
  });

  for (const tag of tags) {
    tagsContainer.appendChild(createTagPill(tag.tagName, bookmarkId, onTagsChange));
  }
  section.appendChild(tagsContainer);

  const inputWrapper = createElement('div', {
    style: { position: 'relative' }
  });

  const input = createElement('input', {
    attributes: { type: 'text', placeholder: 'Type to add tag...' },
    className: 'input'
  });

  const dropdown = createElement('div', {
    className: 'tag-dropdown'
  });

  const existingTagNames = tags.map(t => t.tagName);

  const addHoverStyles = (element: HTMLElement): void => {
    element.addEventListener('mouseenter', () => { element.style.background = 'var(--bg-secondary)'; });
    element.addEventListener('mouseleave', () => { element.style.background = 'transparent'; });
  };

  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';

    if (!value) {
      dropdown.style.display = 'none';
      return;
    }

    const matches = allTags
      .filter(t => t.includes(value) && !existingTagNames.includes(t))
      .slice(0, 5);

    for (const match of matches) {
      const item = createElement('div', {
        textContent: `#${match}`,
        className: 'tag-dropdown-item'
      });
      addHoverStyles(item);
      item.addEventListener('click', () => addTag(normalizeTagName(match), bookmarkId, container, onTagsChange));
      dropdown.appendChild(item);
    }

    const normalizedValue = normalizeTagName(value);
    if (!allTags.includes(normalizedValue)) {
      const createItem = createElement('div', {
        textContent: `Create "#${normalizedValue}"`,
        className: 'tag-dropdown-item create'
      });
      if (matches.length > 0) {
        createItem.style.borderTop = '1px solid var(--border-primary)';
      }
      createItem.style.color = 'var(--accent-link)';
      addHoverStyles(createItem);
      createItem.addEventListener('click', () => addTag(normalizedValue, bookmarkId, container, onTagsChange));
      dropdown.appendChild(createItem);
    }

    dropdown.style.display = dropdown.children.length > 0 ? 'block' : 'none';
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = normalizeTagName(input.value);
      if (value) {
        await addTag(value, bookmarkId, container, onTagsChange);
      }
    }
  });

  const handleClickOutside = (e: MouseEvent): void => {
    if (!inputWrapper.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  };
  document.addEventListener('click', handleClickOutside);

  const cleanup = (): void => {
    document.removeEventListener('click', handleClickOutside);
  };
  containerWithCleanup._cleanup = cleanup;

  inputWrapper.appendChild(input);
  inputWrapper.appendChild(dropdown);
  section.appendChild(inputWrapper);
  container.appendChild(section);
}

function createTagPill(tagName: string, bookmarkId: string, onTagsChange?: () => void): HTMLElement {
  const pill = createElement('span', {
    className: 'tag-pill'
  });

  pill.appendChild(createElement('span', { textContent: `#${tagName}` }));

  const removeBtn = createElement('button', {
    textContent: '×'
  });

  removeBtn.addEventListener('click', async () => {
    await db.bookmarkTags.where({ bookmarkId, tagName }).delete();
    pill.remove();
    if (onTagsChange) onTagsChange();
    await broadcastEvent('TAG_UPDATED', { bookmarkId, tagName, action: 'removed' });
  });

  pill.appendChild(removeBtn);
  return pill;
}

async function addTag(tagName: string, bookmarkId: string, container: HTMLElement, onTagsChange?: () => void): Promise<void> {
  const existing = await db.bookmarkTags.where({ bookmarkId, tagName }).first();
  if (!existing) {
    await db.bookmarkTags.add({
      bookmarkId,
      tagName,
      addedAt: new Date()
    });
    await broadcastEvent('TAG_UPDATED', { bookmarkId, tagName, action: 'added' });
  }
  await createTagEditor({ bookmarkId, container, onTagsChange });
}

async function getAllTags(): Promise<string[]> {
  const allBookmarkTags = await db.bookmarkTags.toArray();
  return [...new Set(allBookmarkTags.map((t: BookmarkTag) => t.tagName))].sort();
}
