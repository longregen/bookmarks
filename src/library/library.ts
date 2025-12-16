import { db, BookmarkTag } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';

let selectedTag = 'All';
let sortBy = 'newest';

const tagList = document.getElementById('tagList')!;
const bookmarkList = document.getElementById('bookmarkList')!;
const bookmarkCount = document.getElementById('bookmarkCount')!;
const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;

// Initialize bookmark detail manager
const detailManager = new BookmarkDetailManager({
  detailPanel: document.getElementById('detailPanel')!,
  detailBackdrop: document.getElementById('detailBackdrop')!,
  detailContent: document.getElementById('detailContent')!,
  closeBtn: document.getElementById('closeDetailBtn') as HTMLButtonElement,
  deleteBtn: document.getElementById('deleteBtn') as HTMLButtonElement,
  exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
  debugBtn: document.getElementById('debugBtn') as HTMLButtonElement,
  onDelete: () => {
    loadTags();
    loadBookmarks();
  },
  onTagsChange: () => {
    loadTags();
    loadBookmarks();
  }
});

sortSelect.addEventListener('change', () => {
  sortBy = sortSelect.value;
  loadBookmarks();
});

async function loadTags() {
  const bookmarks = await db.bookmarks.toArray();
  const allTags: { [key: string]: number } = {};

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray() || [];
    for (const tag of tags) {
      allTags[tag.tagName] = (allTags[tag.tagName] || 0) + 1;
    }
  }

  const untaggedCount = bookmarks.length - Object.values(allTags).reduce((sum, count) => sum + count, 0);

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

function selectTag(tag: string) {
  selectedTag = tag;
  loadTags();
  loadBookmarks();
}

async function loadBookmarks() {
  let bookmarks = await db.bookmarks.toArray();

  if (selectedTag !== 'All') {
    if (selectedTag === 'Untagged') {
      const taggedIds = new Set((await db.bookmarkTags.toArray() || []).map(t => t.bookmarkId));
      bookmarks = bookmarks.filter(b => !taggedIds.has(b.id));
    } else {
      const taggedIds = new Set((await db.bookmarkTags.where('tagName').equals(selectedTag).toArray() || []).map(t => t.bookmarkId));
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

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray() || [];
    const card = createElement('div', { className: 'bookmark-card' });
    card.onclick = () => detailManager.showDetail(bookmark.id);

    const header = createElement('div', { className: 'card-header' });
    header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
    header.appendChild(createElement('div', { className: `status-dot status-${bookmark.status}` }));
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

    bookmarkList.appendChild(card);
  }
}

initTheme();
onThemeChange((theme) => applyTheme(theme));
loadTags();
loadBookmarks();
setInterval(() => { loadTags(); loadBookmarks(); }, 5000);

// Initialize health indicator
const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}

// Check for bookmarkId URL parameter and open the bookmark if present
const urlParams = new URLSearchParams(window.location.search);
const bookmarkIdParam = urlParams.get('bookmarkId');
if (bookmarkIdParam) {
  // Wait for bookmarks to load, then show detail
  setTimeout(() => {
    detailManager.showDetail(bookmarkIdParam);
  }, 500);
}

// Expose test helpers for E2E tests
declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<any>;
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
        contentLength: m.content?.length || 0,
        contentPreview: m.content?.substring(0, 200) || ''
      }))
    };
  }
};
