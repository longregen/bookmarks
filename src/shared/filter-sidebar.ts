/**
 * Filter Sidebar Component
 *
 * Provides filtering interfaces for Library, Search, and Stumble pages:
 * - Library: Tag list with counts and selection
 * - Search/Stumble: Checkbox filters for tags and status
 */

import { createElement } from '../lib/dom.js';

// =====================================================================
// LIBRARY TAG SIDEBAR (Tag list with counts)
// =====================================================================

export interface LibraryTagSidebarOptions {
  tagCounts: Map<string, number>;  // tag name -> count
  totalCount: number;
  untaggedCount: number;
  selectedTag: string | null;  // null = All, 'untagged' = Untagged, or tag name
  onTagSelect: (tag: string | null) => void;
}

export function createLibraryTagSidebar(options: LibraryTagSidebarOptions): HTMLElement {
  const sidebar = createElement('div', { className: 'filter-sidebar' });

  // Sidebar title
  const title = createElement('div', {
    className: 'filter-sidebar__title',
    textContent: 'TAGS'
  });

  sidebar.appendChild(title);

  // "All" option
  const allItem = createLibraryTagItem(
    'All',
    options.totalCount,
    options.selectedTag === null,
    () => options.onTagSelect(null)
  );
  sidebar.appendChild(allItem);

  // "Untagged" option
  const untaggedItem = createLibraryTagItem(
    'Untagged',
    options.untaggedCount,
    options.selectedTag === 'untagged',
    () => options.onTagSelect('untagged')
  );
  sidebar.appendChild(untaggedItem);

  // Separator
  const separator = createElement('div', { className: 'filter-sidebar__separator' });
  sidebar.appendChild(separator);

  // User tags (sorted alphabetically)
  const sortedTags = Array.from(options.tagCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  sortedTags.forEach(([tagName, count]) => {
    const tagItem = createLibraryTagItem(
      `#${tagName}`,
      count,
      options.selectedTag === tagName,
      () => options.onTagSelect(tagName)
    );
    sidebar.appendChild(tagItem);
  });

  return sidebar;
}

function createLibraryTagItem(
  label: string,
  count: number,
  selected: boolean,
  onClick: () => void
): HTMLElement {
  const item = createElement('div', {
    className: `filter-sidebar__tag-item${selected ? ' filter-sidebar__tag-item--selected' : ''}`
  });

  const labelEl = createElement('span', {
    className: 'filter-sidebar__tag-label',
    textContent: label
  });

  const countEl = createElement('span', {
    className: 'filter-sidebar__tag-count',
    textContent: String(count)
  });

  item.appendChild(labelEl);
  item.appendChild(countEl);

  item.addEventListener('click', onClick);

  return item;
}

// =====================================================================
// SEARCH/STUMBLE CHECKBOX FILTERS
// =====================================================================

export interface FilterSidebarOptions {
  mode: 'search' | 'stumble';
  availableTags: string[];
  selectedTags: string[];  // empty = select all
  availableStatuses?: ('complete' | 'pending' | 'error')[];  // Only for search mode
  selectedStatuses?: string[];  // empty = select all, only for search mode
  onTagFilterChange: (selectedTags: string[]) => void;
  onStatusFilterChange?: (selectedStatuses: string[]) => void;  // Only for search mode
}

export function createFilterSidebar(options: FilterSidebarOptions): HTMLElement {
  const sidebar = createElement('div', { className: 'filter-sidebar' });

  // Sidebar title
  const title = createElement('div', {
    className: 'filter-sidebar__title',
    textContent: options.mode === 'search' ? 'FILTERS' : 'FILTER'
  });

  sidebar.appendChild(title);

  // Tags section
  const tagsSection = createCheckboxFilterSection(
    'Tags:',
    options.availableTags.map(tag => ({ value: tag, label: `#${tag}` })),
    options.selectedTags,
    options.onTagFilterChange
  );
  sidebar.appendChild(tagsSection);

  // Status section (only for search mode)
  if (options.mode === 'search' && options.availableStatuses && options.onStatusFilterChange) {
    const separator = createElement('div', { className: 'filter-sidebar__separator' });
    sidebar.appendChild(separator);

    const statusOptions = options.availableStatuses.map(status => ({
      value: status,
      label: status.charAt(0).toUpperCase() + status.slice(1)
    }));

    const statusSection = createCheckboxFilterSection(
      'Status:',
      statusOptions,
      options.selectedStatuses || [],
      options.onStatusFilterChange
    );
    sidebar.appendChild(statusSection);
  }

  return sidebar;
}

interface CheckboxOption {
  value: string;
  label: string;
}

function createCheckboxFilterSection(
  title: string,
  options: CheckboxOption[],
  selectedValues: string[],
  onChange: (selectedValues: string[]) => void
): HTMLElement {
  const section = createElement('div', { className: 'filter-sidebar__section' });

  // Section title
  const sectionTitle = createElement('div', {
    className: 'filter-sidebar__section-title',
    textContent: title
  });
  section.appendChild(sectionTitle);

  // Track state
  const state = {
    selectedValues: new Set(selectedValues)
  };

  // Render function
  const render = () => {
    // Clear existing checkboxes (keep title)
    while (section.children.length > 1) {
      section.removeChild(section.lastChild!);
    }

    // "Select all" checkbox
    const allSelected = state.selectedValues.size === 0;
    const selectAllItem = createCheckboxItem(
      'Select all',
      allSelected,
      () => {
        // Clear all selections
        state.selectedValues.clear();
        onChange([]);
        render();
      }
    );
    section.appendChild(selectAllItem);

    // Individual option checkboxes
    options.forEach((option) => {
      const checked = state.selectedValues.has(option.value);
      const checkboxItem = createCheckboxItem(
        option.label,
        checked,
        () => {
          if (checked) {
            state.selectedValues.delete(option.value);
          } else {
            state.selectedValues.add(option.value);
          }
          onChange(Array.from(state.selectedValues));
          render();
        }
      );
      section.appendChild(checkboxItem);
    });
  };

  // Initial render
  render();

  return section;
}

function createCheckboxItem(
  label: string,
  checked: boolean,
  onChange: () => void
): HTMLElement {
  const item = createElement('label', { className: 'filter-sidebar__checkbox-item' });

  const checkbox = createElement('input', {
    className: 'filter-sidebar__checkbox',
    attributes: { type: 'checkbox' }
  }) as HTMLInputElement;

  checkbox.checked = checked;
  checkbox.addEventListener('change', onChange);

  const labelEl = createElement('span', {
    className: 'filter-sidebar__checkbox-label',
    textContent: label
  });

  item.appendChild(checkbox);
  item.appendChild(labelEl);

  return item;
}

// =====================================================================
// CSS INJECTION
// =====================================================================

export function injectFilterSidebarStyles(): void {
  const styleId = 'filter-sidebar-styles';

  // Check if styles already injected
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Filter Sidebar Component */
    .filter-sidebar {
      width: 200px;
      flex-shrink: 0;
      padding: var(--space-6);
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      overflow-y: auto;
    }

    /* Responsive: Laptop */
    @media (max-width: 1199px) {
      .filter-sidebar {
        width: 180px;
      }
    }

    .filter-sidebar__title {
      font-size: var(--text-xs);
      font-weight: var(--font-semibold);
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--space-4);
    }

    .filter-sidebar__separator {
      height: 1px;
      background: var(--border-secondary);
      margin: var(--space-4) 0;
    }

    /* ===== Library Tag List ===== */
    .filter-sidebar__tag-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--space-2) var(--space-3);
      margin-bottom: var(--space-1);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .filter-sidebar__tag-item:hover {
      background: var(--bg-hover);
    }

    .filter-sidebar__tag-item--selected {
      background: var(--bg-hover);
      font-weight: var(--font-medium);
    }

    .filter-sidebar__tag-label {
      font-size: var(--text-base);
      color: var(--text-primary);
      flex: 1;
    }

    .filter-sidebar__tag-count {
      font-size: var(--text-sm);
      color: var(--text-tertiary);
      font-weight: var(--font-medium);
      margin-left: var(--space-2);
    }

    /* ===== Checkbox Filters ===== */
    .filter-sidebar__section {
      margin-bottom: var(--space-6);
    }

    .filter-sidebar__section:last-child {
      margin-bottom: 0;
    }

    .filter-sidebar__section-title {
      font-size: var(--text-base);
      font-weight: var(--font-medium);
      color: var(--text-primary);
      margin-bottom: var(--space-3);
    }

    .filter-sidebar__checkbox-item {
      display: flex;
      align-items: center;
      padding: var(--space-2) var(--space-3);
      margin-bottom: var(--space-1);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: background var(--transition-fast);
      user-select: none;
    }

    .filter-sidebar__checkbox-item:hover {
      background: var(--bg-hover);
    }

    .filter-sidebar__checkbox {
      width: 16px;
      height: 16px;
      margin: 0;
      margin-right: var(--space-3);
      cursor: pointer;
      flex-shrink: 0;
    }

    .filter-sidebar__checkbox-label {
      font-size: var(--text-base);
      color: var(--text-primary);
      cursor: pointer;
    }

    /* Scrollbar styling for sidebar */
    .filter-sidebar::-webkit-scrollbar {
      width: 8px;
    }

    .filter-sidebar::-webkit-scrollbar-track {
      background: var(--bg-tertiary);
    }

    .filter-sidebar::-webkit-scrollbar-thumb {
      background: var(--border-secondary);
      border-radius: 4px;
    }

    .filter-sidebar::-webkit-scrollbar-thumb:hover {
      background: var(--text-tertiary);
    }
  `;

  document.head.appendChild(style);
}
