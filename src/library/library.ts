import { db, type BookmarkTag } from '../db/schema';
import { createElement, getElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initWeb } from '../web/init-web';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';

let selectedTag = 'All';
let sortBy = 'newest';

function getStatusClass(status: string): string {
  const statusMap: Record<string, string> = {
    'complete': 'card-status--complete',
    'pending': 'card-status--pending',
    'processing': 'card-status--processing',
    'error': 'card-status--error'
  };
  return statusMap[status] || 'card-status--pending';
}

function getStatusLabel(status: string): string {
  const labelMap: Record<string, string> = {
    'complete': '✓',
    'pending': 'pending',
    'processing': 'processing',
    'error': 'error'
  };
  return labelMap[status] || status;
}

const tagList = getElement('tagList');
const bookmarkList = getElement('bookmarkList');
const bookmarkCount = getElement('bookmarkCount');
const sortSelect = getElement<HTMLSelectElement>('sortSelect');

const detailPanel = getElement('detailPanel');
const detailBackdrop = getElement('detailBackdrop');
const detailContent = getElement('detailContent');

const detailManager = new BookmarkDetailManager({
  detailPanel,
  detailBackdrop,
  detailContent,
  closeBtn: getElement<HTMLButtonElement>('closeDetailBtn'),
  deleteBtn: getElement<HTMLButtonElement>('deleteBtn'),
  exportBtn: getElement<HTMLButtonElement>('exportBtn'),
  debugBtn: getElement<HTMLButtonElement>('debugBtn'),
  onDelete: () => {
    void loadTags();
    void loadBookmarks();
  },
  onTagsChange: () => {
    void loadTags();
    void loadBookmarks();
  }
});

sortSelect.addEventListener('change', () => {
  sortBy = sortSelect.value;
  void loadBookmarks();
});

async function loadTags(): Promise<void> {
  const bookmarks = await db.bookmarks.toArray();

  const allTagRecords = await db.bookmarkTags.toArray();
  const allTags: Record<string, number> = {};
  const taggedBookmarkIds = new Set<string>();

  for (const tagRecord of allTagRecords) {
    allTags[tagRecord.tagName] = (allTags[tagRecord.tagName] || 0) + 1;
    taggedBookmarkIds.add(tagRecord.bookmarkId);
  }

  const untaggedCount = bookmarks.length - taggedBookmarkIds.size;

  tagList.innerHTML = '';

  const allTag = createElement('div', { className: `tag-item ${selectedTag === 'All' ? 'active' : ''}` });
  allTag.onclick = () => selectTag('All');
  allTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'All' }));
  allTag.appendChild(createElement('span', { className: 'tag-count', textContent: bookmarks.length.toString() }));
  tagList.appendChild(allTag);

  if (untaggedCount > 0) {
    const untaggedTag = createElement('div', { className: `tag-item ${selectedTag === 'Untagged' ? 'active' : ''}` });
    untaggedTag.onclick = () => selectTag('Untagged');
    untaggedTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'Untagged' }));
    untaggedTag.appendChild(createElement('span', { className: 'tag-count', textContent: untaggedCount.toString() }));
    tagList.appendChild(untaggedTag);
  }

  tagList.appendChild(createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-3) 0' } }));

  for (const [tagName, count] of Object.entries(allTags).sort()) {
    const tagItem = createElement('div', { className: `tag-item ${selectedTag === tagName ? 'active' : ''}` });
    tagItem.onclick = () => selectTag(tagName);
    tagItem.appendChild(createElement('span', { className: 'tag-name', textContent: `#${tagName}` }));
    tagItem.appendChild(createElement('span', { className: 'tag-count', textContent: count.toString() }));
    tagList.appendChild(tagItem);
  }
}

function selectTag(tag: string): void {
  selectedTag = tag;
  void loadTags();
  void loadBookmarks();
}

async function loadBookmarks(): Promise<void> {
  let bookmarks = await db.bookmarks.toArray();

  if (selectedTag !== 'All') {
    if (selectedTag === 'Untagged') {
      const taggedIds = new Set((await db.bookmarkTags.toArray()).map(t => t.bookmarkId));
      bookmarks = bookmarks.filter(b => !taggedIds.has(b.id));
    } else {
      const taggedIds = new Set((await db.bookmarkTags.where('tagName').equals(selectedTag).toArray()).map(t => t.bookmarkId));
      bookmarks = bookmarks.filter(b => taggedIds.has(b.id));
    }
  }

  if (sortBy === 'newest') bookmarks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  else if (sortBy === 'oldest') bookmarks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  else if (sortBy === 'title') bookmarks.sort((a, b) => a.title.localeCompare(b.title));

  bookmarkList.innerHTML = '';
  bookmarkCount.textContent = bookmarks.length.toString();

  if (bookmarks.length === 0) {
    bookmarkList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No bookmarks found' }));
    return;
  }

  // Add table header
  const header = createElement('div', { className: 'bookmark-list-header' });
  header.appendChild(createElement('span', { textContent: 'Title' }));
  header.appendChild(createElement('span', { textContent: 'Source' }));
  header.appendChild(createElement('span', { textContent: 'Saved', style: { textAlign: 'right' } }));
  header.appendChild(createElement('span', { textContent: 'Status', style: { textAlign: 'right' } }));
  bookmarkList.appendChild(header);

  // Batch load all tags for the filtered bookmarks to avoid N+1 query pattern
  const bookmarkIds = bookmarks.map(b => b.id);
  const allTags = await db.bookmarkTags.where('bookmarkId').anyOf(bookmarkIds).toArray();

  const tagsByBookmarkId = new Map<string, BookmarkTag[]>();
  for (const tag of allTags) {
    const existing = tagsByBookmarkId.get(tag.bookmarkId);
    if (existing) {
      existing.push(tag);
    } else {
      tagsByBookmarkId.set(tag.bookmarkId, [tag]);
    }
  }

  for (const bookmark of bookmarks) {
    const tags = tagsByBookmarkId.get(bookmark.id) ?? [];
    const card = createElement('div', { className: 'bookmark-card' });
    card.onclick = () => detailManager.showDetail(bookmark.id);

    // Title column
    const titleCol = createElement('div', { className: 'card-header' });
    titleCol.appendChild(createElement('span', { className: 'card-title', textContent: bookmark.title }));
    card.appendChild(titleCol);

    // Source column
    const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
    url.onclick = (e) => e.stopPropagation();
    card.appendChild(url);

    // Date column
    card.appendChild(createElement('span', { className: 'card-date', textContent: formatDateByAge(bookmark.createdAt) }));

    // Status column - text label instead of dot
    const statusLabel = getStatusLabel(bookmark.status);
    card.appendChild(createElement('span', {
      className: `card-status ${getStatusClass(bookmark.status)}`,
      textContent: statusLabel
    }));

    // Tags row (spans all columns)
    if (tags.length > 0) {
      const tagContainer = createElement('div', { className: 'card-tags' });
      for (const tag of tags) {
        tagContainer.appendChild(createElement('span', { className: 'tag-badge', textContent: tag.tagName }));
      }
      card.appendChild(tagContainer);
    }

    bookmarkList.appendChild(card);
  }
}

if (__IS_WEB__) {
  void initWeb();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

const urlParams = new URLSearchParams(window.location.search);
const bookmarkIdParam = urlParams.get('bookmarkId');

async function initializeApp(): Promise<void> {
  await Promise.all([loadTags(), loadBookmarks()]);

  if (bookmarkIdParam !== null && bookmarkIdParam !== '') {
    await detailManager.showDetail(bookmarkIdParam);
  }
}

void initializeApp();

const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type === 'BOOKMARK_UPDATED' || event.type === 'PROCESSING_COMPLETE' || event.type === 'TAG_UPDATED') {
    void loadTags();
    void loadBookmarks();
  }
});

const fallbackInterval = setInterval(() => {
  void loadTags();
  void loadBookmarks();
}, 30000);

window.addEventListener('beforeunload', () => {
  removeEventListener();
  clearInterval(fallbackInterval);
});

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}

declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<unknown>;
    };
  }
}

window.__testHelpers = {
  async getBookmarkStatus() {
    const bookmarks = await db.bookmarks.toArray();
    const markdown = await db.markdown.toArray();

    return {
      bookmarks: bookmarks.map(b => ({
        id: b.id,
        title: b.title,
        url: b.url,
        status: b.status,
        errorMessage: b.errorMessage,
        createdAt: b.createdAt
      })),
      markdown: markdown.map(m => ({
        bookmarkId: m.bookmarkId,
        contentLength: m.content ? m.content.length : 0,
        contentPreview: m.content ? m.content.substring(0, 200) : ''
      }))
    };
  }
};
