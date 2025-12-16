import { db, BookmarkTag } from '../db/schema';
import { createElement } from './dom';

/**
 * Configuration for tag filter
 */
export interface TagFilterConfig {
  container: HTMLElement;
  selectedTags: Set<string>;
  onChange: () => void;
}

/**
 * Loads and renders tag filters
 */
export async function loadTagFilters(config: TagFilterConfig) {
  const bookmarks = await db.bookmarks.toArray();
  const allTags = new Set<string>();

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray();
    tags.forEach((t: BookmarkTag) => allTags.add(t.tagName));
  }

  config.container.innerHTML = '';

  // Create "Clear selection" button (only shown when tags are selected)
  if (config.selectedTags.size > 0) {
    const clearBtn = createElement('button', {
      className: 'clear-selection-btn',
      textContent: 'Clear selection'
    }) as HTMLButtonElement;
    clearBtn.onclick = () => {
      config.selectedTags.clear();
      config.onChange();
    };
    config.container.appendChild(clearBtn);
  }

  // Create individual tag checkboxes
  for (const tag of Array.from(allTags).sort()) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', {
      attributes: { type: 'checkbox', checked: config.selectedTags.has(tag) ? 'checked' : '' }
    }) as HTMLInputElement;
    cb.onchange = () => {
      if (cb.checked) {
        config.selectedTags.add(tag);
      } else {
        config.selectedTags.delete(tag);
      }
      config.onChange();
    };
    label.appendChild(cb);
    label.appendChild(createElement('span', { textContent: `#${tag}` }));
    config.container.appendChild(label);
  }
}
