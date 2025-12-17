import { db, BookmarkTag } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initWeb } from '../web/init-web';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';
import { validateSingleUrl, createBulkImportJob } from '../lib/bulk-import';
import { processBulkFetch } from '../background/fetcher';

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

  // Batch load all tags at once to avoid N+1 query pattern
  const allTagRecords = await db.bookmarkTags.toArray();
  const allTags: { [key: string]: number } = {};
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

  // Batch load all tags for the filtered bookmarks to avoid N+1 query pattern
  const bookmarkIds = bookmarks.map(b => b.id);
  const allTags = await db.bookmarkTags.where('bookmarkId').anyOf(bookmarkIds).toArray();

  // Group tags by bookmarkId for efficient lookup
  const tagsByBookmarkId = new Map<string, BookmarkTag[]>();
  for (const tag of allTags) {
    if (!tagsByBookmarkId.has(tag.bookmarkId)) {
      tagsByBookmarkId.set(tag.bookmarkId, []);
    }
    tagsByBookmarkId.get(tag.bookmarkId)!.push(tag);
  }

  for (const bookmark of bookmarks) {
    const tags = tagsByBookmarkId.get(bookmark.id) || [];
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

// Initialize platform and theme
if (__IS_WEB__) {
  initWeb();
  initAddUrlSection();
} else {
  initExtension();
}
onThemeChange((theme) => applyTheme(theme));
loadTags();
loadBookmarks();

// Initialize Add URL section for web version
function initAddUrlSection() {
  const addUrlSection = document.getElementById('addUrlSection');
  const addUrlInput = document.getElementById('addUrlInput') as HTMLInputElement;
  const addUrlBtn = document.getElementById('addUrlBtn') as HTMLButtonElement;
  const addUrlStatus = document.getElementById('addUrlStatus')!;

  if (!addUrlSection || !addUrlInput || !addUrlBtn || !addUrlStatus) return;

  // Show the section in web mode
  addUrlSection.classList.remove('hidden');

  async function addUrl() {
    const url = addUrlInput.value.trim();
    if (!url) return;

    const validation = validateSingleUrl(url);
    if (!validation.isValid) {
      showAddUrlStatus(validation.error || 'Invalid URL', 'error');
      return;
    }

    addUrlBtn.disabled = true;
    addUrlBtn.textContent = 'Adding...';
    showAddUrlStatus('Fetching page...', 'info');

    try {
      const jobId = await createBulkImportJob([validation.normalized]);
      await processBulkFetch(jobId);

      addUrlInput.value = '';
      showAddUrlStatus('Bookmark added successfully!', 'success');
      loadTags();
      loadBookmarks();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add bookmark';
      showAddUrlStatus(errorMessage, 'error');
    } finally {
      addUrlBtn.disabled = false;
      addUrlBtn.textContent = 'Add';
    }
  }

  function showAddUrlStatus(message: string, type: 'success' | 'error' | 'info') {
    addUrlStatus.textContent = message;
    addUrlStatus.className = `add-url-status ${type}`;
    addUrlStatus.classList.remove('hidden');

    if (type === 'success') {
      setTimeout(() => {
        addUrlStatus.classList.add('hidden');
      }, 3000);
    }
  }

  addUrlBtn.addEventListener('click', addUrl);
  addUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUrl();
  });
}

// Event-driven updates instead of constant polling
const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type === 'BOOKMARK_UPDATED' || event.type === 'PROCESSING_COMPLETE' || event.type === 'TAG_UPDATED') {
    loadTags();
    loadBookmarks();
  }
});

// Minimal fallback polling every 30 seconds (instead of 5)
const fallbackInterval = setInterval(() => {
  loadTags();
  loadBookmarks();
}, 30000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  removeEventListener();
  clearInterval(fallbackInterval);
});

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
