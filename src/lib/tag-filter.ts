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

  // Create "Select all" checkbox
  const selectAll = createElement('label', { className: 'filter-item' });
  const selectAllCb = createElement('input', {
    attributes: { type: 'checkbox', checked: config.selectedTags.size === 0 ? 'checked' : '' }
  }) as HTMLInputElement;
  selectAllCb.onchange = () => {
    config.selectedTags.clear();
    config.onChange();
  };
  selectAll.appendChild(selectAllCb);
  selectAll.appendChild(createElement('span', { textContent: 'Select all' }));
  config.container.appendChild(selectAll);

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
