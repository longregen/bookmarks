import { db } from '../db/schema';
import type { BookmarkTag } from '../db/schema';
import { createElement } from './dom';

export interface TagFilterConfig {
  container: HTMLElement;
  selectedTags: Set<string>;
  onChange: () => void;
}

export async function loadTagFilters(config: TagFilterConfig): Promise<void> {
  // Load all tags in a single query instead of N+1 queries per bookmark
  const allBookmarkTags = await db.bookmarkTags.toArray();
  const allTags = new Set<string>(allBookmarkTags.map((t: BookmarkTag) => t.tagName));

  config.container.innerHTML = '';

  if (config.selectedTags.size > 0) {
    const clearBtn = createElement('button', {
      className: 'clear-selection-btn',
      textContent: 'Clear selection'
    });
    clearBtn.onclick = () => {
      config.selectedTags.clear();
      config.onChange();
    };
    config.container.appendChild(clearBtn);
  }

  for (const tag of Array.from(allTags).sort()) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', {
      attributes: { type: 'checkbox' }
    });
    cb.checked = config.selectedTags.has(tag);
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
