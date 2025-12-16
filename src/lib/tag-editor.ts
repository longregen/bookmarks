import { db, BookmarkTag } from '../db/schema';
import { createElement } from './dom';
import { broadcastEvent } from './events';

export interface TagEditorOptions {
  bookmarkId: string;
  container: HTMLElement;
  onTagsChange?: () => void;
}

export async function createTagEditor(options: TagEditorOptions): Promise<void> {
  const { bookmarkId, container, onTagsChange } = options;

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
  }) as HTMLInputElement;

  const dropdown = createElement('div', {
    className: 'tag-dropdown'
  });

  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';

    if (!value) {
      dropdown.style.display = 'none';
      return;
    }

    const existingTagNames = tags.map(t => t.tagName);
    const matches = allTags
      .filter(t => t.includes(value) && !existingTagNames.includes(t))
      .slice(0, 5);

    for (const match of matches) {
      const item = createElement('div', {
        textContent: `#${match}`,
        className: 'tag-dropdown-item'
      });
      item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-secondary)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', () => addTag(match, bookmarkId, container, onTagsChange));
      dropdown.appendChild(item);
    }

    if (!allTags.includes(value) && value.length > 0) {
      const createItem = createElement('div', {
        textContent: `Create "#${value}"`,
        className: 'tag-dropdown-item create'
      });
      if (matches.length > 0) {
        createItem.style.borderTop = '1px solid var(--border-primary)';
      }
      createItem.style.color = 'var(--accent-link)';
      createItem.addEventListener('mouseenter', () => createItem.style.background = 'var(--bg-secondary)');
      createItem.addEventListener('mouseleave', () => createItem.style.background = 'transparent');
      createItem.addEventListener('click', () => addTag(value, bookmarkId, container, onTagsChange));
      dropdown.appendChild(createItem);
    }

    dropdown.style.display = dropdown.children.length > 0 ? 'block' : 'none';
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (value) {
        await addTag(value, bookmarkId, container, onTagsChange);
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!inputWrapper.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  });

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
    // Broadcast tag update event to notify all pages
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
    // Broadcast tag update event to notify all pages
    await broadcastEvent('TAG_UPDATED', { bookmarkId, tagName, action: 'added' });
  }
  await createTagEditor({ bookmarkId, container, onTagsChange });
}

async function getAllTags(): Promise<string[]> {
  const allBookmarkTags = await db.bookmarkTags.toArray();
  return [...new Set(allBookmarkTags.map((t: BookmarkTag) => t.tagName))].sort();
}
