import { db, type BookmarkTag } from '../db/schema';
import { createElement, getElement } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWeb } from '../web/init-web';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { createHealthIndicator } from '../ui/health-indicator';
import { BookmarkDetailManager } from '../ui/bookmark-detail';

let selectedTag = 'All';
let sortBy = 'newest';

function getStatusModifier(status: string): string {
  const statusMap: Record<string, string> = {
    'complete': 'status-dot--success',
    'pending': 'status-dot--warning',
    'processing': 'status-dot--info',
    'error': 'status-dot--error'
  };
  return statusMap[status] || 'status-dot--warning';
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
  retryBtn: getElement<HTMLButtonElement>('retryBtn'),
  onDelete: () => {
    void loadTags();
    void loadBookmarks();
  },
  onTagsChange: () => {
    void loadTags();
    void loadBookmarks();
  },
  onRetry: () => {
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

  const fragment = document.createDocumentFragment();

  const allTag = createElement('div', { className: `tag-item ${selectedTag === 'All' ? 'active' : ''}` });
  allTag.onclick = () => selectTag('All');
  allTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'All' }));
  allTag.appendChild(createElement('span', { className: 'tag-count', textContent: bookmarks.length.toString() }));
  fragment.appendChild(allTag);

  if (untaggedCount > 0) {
    const untaggedTag = createElement('div', { className: `tag-item ${selectedTag === 'Untagged' ? 'active' : ''}` });
    untaggedTag.onclick = () => selectTag('Untagged');
    untaggedTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'Untagged' }));
    untaggedTag.appendChild(createElement('span', { className: 'tag-count', textContent: untaggedCount.toString() }));
    fragment.appendChild(untaggedTag);
  }

  fragment.appendChild(createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-3) 0' } }));

  for (const [tagName, count] of Object.entries(allTags).sort()) {
    const tagItem = createElement('div', { className: `tag-item ${selectedTag === tagName ? 'active' : ''}` });
    tagItem.onclick = () => selectTag(tagName);
    tagItem.appendChild(createElement('span', { className: 'tag-name', textContent: `#${tagName}` }));
    tagItem.appendChild(createElement('span', { className: 'tag-count', textContent: count.toString() }));
    fragment.appendChild(tagItem);
  }

  tagList.innerHTML = '';
  tagList.appendChild(fragment);
}

function selectTag(tag: string): void {
  selectedTag = tag;
  void loadTags();
  void loadBookmarks();
}

async function loadBookmarks(): Promise<void> {
  let bookmarks;

  if (selectedTag === 'All') {
    bookmarks = await db.bookmarks.toArray();
  } else if (selectedTag === 'Untagged') {
    const allBookmarks = await db.bookmarks.toArray();
    const taggedIds = new Set((await db.bookmarkTags.toArray()).map(t => t.bookmarkId));
    bookmarks = allBookmarks.filter(b => !taggedIds.has(b.id));
  } else {
    const tagRecords = await db.bookmarkTags.where('tagName').equals(selectedTag).toArray();
    const taggedIds = tagRecords.map(t => t.bookmarkId);
    bookmarks = await db.bookmarks.where('id').anyOf(taggedIds).toArray();
  }

  if (sortBy === 'newest') bookmarks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  else if (sortBy === 'oldest') bookmarks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  else if (sortBy === 'title') bookmarks.sort((a, b) => a.title.localeCompare(b.title));

  bookmarkCount.textContent = bookmarks.length.toString();

  if (bookmarks.length === 0) {
    bookmarkList.innerHTML = '';
    bookmarkList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No bookmarks found' }));
    return;
  }

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

  const fragment = document.createDocumentFragment();

  for (const bookmark of bookmarks) {
    const tags = tagsByBookmarkId.get(bookmark.id) ?? [];
    const card = createElement('div', { className: 'bookmark-card' });
    card.onclick = () => detailManager.showDetail(bookmark.id);

    const header = createElement('div', { className: 'card-header' });
    header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
    header.appendChild(createElement('div', { className: `status-dot ${getStatusModifier(bookmark.status)}` }));
    card.appendChild(header);

    const meta = createElement('div', { className: 'card-meta' });
    const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
    url.onclick = (e) => e.stopPropagation();
    meta.appendChild(url);
    meta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)}`));
    card.appendChild(meta);

    if (tags.length > 0) {
      const tagContainer = createElement('div', { className: 'card-tags' });
      for (const tag of tags) {
        tagContainer.appendChild(createElement('span', { className: 'tag-badge', textContent: `#${tag.tagName}` }));
      }
      card.appendChild(tagContainer);
    }

    fragment.appendChild(card);
  }

  bookmarkList.innerHTML = '';
  bookmarkList.appendChild(fragment);
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
  if (event.type.startsWith('bookmark:') || event.type.startsWith('tag:')) {
    void loadTags();
    void loadBookmarks();
  }
});

let healthCleanup: (() => void) | null = null;

window.addEventListener('beforeunload', () => {
  removeEventListener();
  healthCleanup?.();
});

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  healthCleanup = createHealthIndicator(healthIndicatorContainer);
}

declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<unknown>;
      exportAllBookmarks: () => Promise<unknown>;
    };
  }
}

// Dynamic import to avoid bundling issues in test mode
async function getExportModule(): Promise<typeof import('../lib/export')> {
  return await import('../lib/export');
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
  },
  async exportAllBookmarks() {
    const { exportAllBookmarks } = await getExportModule();
    return await exportAllBookmarks();
  }
};
