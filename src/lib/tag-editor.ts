import { db, BookmarkTag } from '../db/schema';
import { createElement } from './dom';

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
    textContent: 'TAGS',
    style: { fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }
  }));

  const tagsContainer = createElement('div', {
    className: 'tag-editor-tags',
    style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }
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
    style: {
      width: '100%',
      padding: 'var(--space-2) var(--space-3)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      fontSize: 'var(--text-sm)'
    }
  }) as HTMLInputElement;

  const dropdown = createElement('div', {
    className: 'tag-dropdown',
    style: {
      position: 'absolute',
      top: '100%',
      left: '0',
      right: '0',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      display: 'none',
      zIndex: '100',
      maxHeight: '150px',
      overflowY: 'auto'
    }
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
        style: {
          padding: 'var(--space-2) var(--space-3)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)'
        }
      });
      item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-secondary)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', () => addTag(match, bookmarkId, container, onTagsChange));
      dropdown.appendChild(item);
    }

    if (!allTags.includes(value) && value.length > 0) {
      const createItem = createElement('div', {
        textContent: `Create "#${value}"`,
        style: {
          padding: 'var(--space-2) var(--space-3)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          borderTop: matches.length > 0 ? '1px solid var(--border-primary)' : 'none',
          color: 'var(--accent-link)'
        }
      });
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
    className: 'tag-pill',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-1)',
      padding: 'var(--space-1) var(--space-2)',
      background: 'var(--bg-tertiary)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--text-sm)'
    }
  });

  pill.appendChild(createElement('span', { textContent: `#${tagName}` }));

  const removeBtn = createElement('button', {
    textContent: '×',
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '0 2px',
      fontSize: 'var(--text-base)',
      color: 'var(--text-secondary)',
      lineHeight: '1'
    }
  });

  removeBtn.addEventListener('click', async () => {
    await db.bookmarkTags.where({ bookmarkId, tagName }).delete();
    pill.remove();
    if (onTagsChange) onTagsChange();
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
  }
  await createTagEditor({ bookmarkId, container, onTagsChange });
}

async function getAllTags(): Promise<string[]> {
  const allBookmarkTags = await db.bookmarkTags.toArray();
  return [...new Set(allBookmarkTags.map((t: BookmarkTag) => t.tagName))].sort();
}
