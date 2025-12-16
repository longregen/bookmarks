import { db, Bookmark, Markdown, QuestionAnswer } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { createHeaderNav, injectHeaderNavStyles } from '../shared/header-nav';
import { createDetailPanel, injectDetailPanelStyles } from '../shared/detail-panel';
import { createLibraryTagSidebar, injectFilterSidebarStyles } from '../shared/filter-sidebar';
import {
  getBookmarkTags,
  getAllTags,
  createTagEditor,
  injectTagEditorStyles
} from '../shared/tag-editor';
import { exportSingleBookmark, downloadExport } from '../lib/export';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';
import {
  injectHealthIndicatorStyles,
  createDiagnosticsModal
} from '../shared/health-indicator.js';

// =====================================================================
// STATE
// =====================================================================

interface BookmarkWithTags extends Bookmark {
  tags: string[];
}

let allBookmarks: BookmarkWithTags[] = [];
let filteredBookmarks: BookmarkWithTags[] = [];
let selectedTag: string | null = null; // null = All, 'untagged' = Untagged, or tag name
let currentSort: 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' = 'date-desc';
let selectedBookmarkId: string | null = null;

// =====================================================================
// DOM ELEMENTS
// =====================================================================

const headerNavContainer = document.getElementById('headerNav') as HTMLDivElement;
const tagSidebarContainer = document.getElementById('tagSidebar') as HTMLElement;
const bookmarkListContainer = document.getElementById('bookmarkList') as HTMLDivElement;
const detailPanelContainer = document.getElementById('detailPanel') as HTMLDivElement;
const bookmarkCountEl = document.getElementById('bookmarkCount') as HTMLSpanElement;
const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;

// =====================================================================
// INITIALIZATION
// =====================================================================

async function init() {
  // Inject styles
  injectHeaderNavStyles();
  injectFilterSidebarStyles();
  injectDetailPanelStyles();
  injectTagEditorStyles();
  injectHealthIndicatorStyles();

  // Initialize theme
  initTheme();
  onThemeChange((theme) => applyTheme(theme));

  // Create header navigation
  const headerNav = createHeaderNav({
    activePage: 'library',
    onHealthClick: () => {
      const modal = createDiagnosticsModal(() => {
        modal.remove();
      });
      document.body.appendChild(modal);
    }
  });
  headerNavContainer.appendChild(headerNav);

  // Load bookmarks
  await loadBookmarks();

  // Render UI
  renderTagSidebar();
  renderBookmarkList();

  // Set up event listeners
  sortSelect.addEventListener('change', handleSortChange);

  // Refresh bookmarks periodically
  setInterval(loadBookmarks, 5000);
}

// =====================================================================
// DATA LOADING
// =====================================================================

async function loadBookmarks() {
  try {
    const bookmarks = await db.bookmarks.toArray();

    // Load tags for each bookmark
    allBookmarks = await Promise.all(
      bookmarks.map(async (bookmark) => {
        const tags = await getBookmarkTags(bookmark.id);
        return { ...bookmark, tags };
      })
    );

    // Apply filters and sorting
    filterAndSortBookmarks();

    // Update UI if data changed
    renderTagSidebar();
    renderBookmarkList();

  } catch (error) {
    console.error('Error loading bookmarks:', error);
    bookmarkListContainer.innerHTML = '';
    bookmarkListContainer.appendChild(
      createElement('div', {
        className: 'error-message',
        textContent: 'Failed to load bookmarks'
      })
    );
  }
}

// =====================================================================
// FILTERING & SORTING
// =====================================================================

function filterAndSortBookmarks() {
  // Filter by selected tag
  if (selectedTag === null) {
    // All bookmarks
    filteredBookmarks = [...allBookmarks];
  } else if (selectedTag === 'untagged') {
    // Only untagged bookmarks
    filteredBookmarks = allBookmarks.filter(b => b.tags.length === 0);
  } else {
    // Bookmarks with specific tag
    filteredBookmarks = allBookmarks.filter(b => b.tags.includes(selectedTag));
  }

  // Sort bookmarks
  sortBookmarks();
}

function sortBookmarks() {
  switch (currentSort) {
    case 'date-desc':
      filteredBookmarks.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      break;
    case 'date-asc':
      filteredBookmarks.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      break;
    case 'title-asc':
      filteredBookmarks.sort((a, b) =>
        a.title.localeCompare(b.title)
      );
      break;
    case 'title-desc':
      filteredBookmarks.sort((a, b) =>
        b.title.localeCompare(a.title)
      );
      break;
  }
}

function handleSortChange() {
  currentSort = sortSelect.value as typeof currentSort;
  filterAndSortBookmarks();
  renderBookmarkList();
}

// =====================================================================
// TAG SIDEBAR RENDERING
// =====================================================================

function renderTagSidebar() {
  // Calculate tag counts
  const tagCounts = new Map<string, number>();

  allBookmarks.forEach(bookmark => {
    bookmark.tags.forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  const untaggedCount = allBookmarks.filter(b => b.tags.length === 0).length;

  // Create sidebar
  const sidebar = createLibraryTagSidebar({
    tagCounts,
    totalCount: allBookmarks.length,
    untaggedCount,
    selectedTag,
    onTagSelect: handleTagSelect
  });

  // Replace sidebar content
  tagSidebarContainer.innerHTML = '';
  tagSidebarContainer.appendChild(sidebar);
}

function handleTagSelect(tag: string | null) {
  selectedTag = tag;
  filterAndSortBookmarks();
  renderTagSidebar();
  renderBookmarkList();

  // Close detail panel when changing filters
  closeDetailPanel();
}

// =====================================================================
// BOOKMARK LIST RENDERING
// =====================================================================

function renderBookmarkList() {
  bookmarkCountEl.textContent = filteredBookmarks.length.toString();

  // Clear list
  bookmarkListContainer.innerHTML = '';

  if (filteredBookmarks.length === 0) {
    const emptyState = createElement('div', { className: 'empty-state' });
    emptyState.appendChild(
      createElement('div', {
        className: 'empty-state__title',
        textContent: selectedTag === 'untagged'
          ? 'No untagged bookmarks'
          : selectedTag
          ? `No bookmarks with tag #${selectedTag}`
          : 'No bookmarks yet'
      })
    );
    emptyState.appendChild(
      createElement('div', {
        className: 'empty-state__description',
        textContent: selectedTag
          ? 'Try selecting a different tag or view all bookmarks'
          : 'Start by saving a page using the browser extension!'
      })
    );
    bookmarkListContainer.appendChild(emptyState);
    return;
  }

  // Render bookmark cards
  filteredBookmarks.forEach(bookmark => {
    const card = createBookmarkCard(bookmark);
    bookmarkListContainer.appendChild(card);
  });
}

function createBookmarkCard(bookmark: BookmarkWithTags): HTMLElement {
  const card = createElement('div', {
    className: `library-bookmark-card${selectedBookmarkId === bookmark.id ? ' library-bookmark-card--selected' : ''}`
  });

  // Title row (with status on right)
  const titleRow = createElement('div', { className: 'library-bookmark-card__title-row' });

  const title = createElement('div', {
    className: 'library-bookmark-card__title',
    textContent: bookmark.title
  });

  const statusSymbol = getStatusSymbol(bookmark.status);
  const statusClass = `library-bookmark-card__status library-bookmark-card__status--${bookmark.status}`;
  const status = createElement('span', {
    className: statusClass,
    textContent: statusSymbol
  });

  titleRow.appendChild(title);
  titleRow.appendChild(status);
  card.appendChild(titleRow);

  // Meta row (URL, time ago, tags)
  const metaRow = createElement('div', { className: 'library-bookmark-card__meta' });

  // URL
  const url = new URL(bookmark.url);
  const urlSpan = createElement('span', {
    className: 'library-bookmark-card__url',
    textContent: url.hostname
  });
  metaRow.appendChild(urlSpan);

  // Separator
  metaRow.appendChild(createElement('span', {
    className: 'library-bookmark-card__separator',
    textContent: '·'
  }));

  // Time ago
  const timeAgo = formatDateByAge(bookmark.createdAt);
  const timeSpan = createElement('span', {
    className: 'library-bookmark-card__time',
    textContent: timeAgo
  });
  metaRow.appendChild(timeSpan);

  // Tags
  if (bookmark.tags.length > 0) {
    metaRow.appendChild(createElement('span', {
      className: 'library-bookmark-card__separator',
      textContent: '·'
    }));

    const tagsSpan = createElement('span', {
      className: 'library-bookmark-card__tags',
      textContent: bookmark.tags.map(t => `#${t}`).join(' ')
    });
    metaRow.appendChild(tagsSpan);
  }

  card.appendChild(metaRow);

  // Click handler
  card.addEventListener('click', () => {
    showBookmarkDetail(bookmark.id);
  });

  return card;
}

/**
 * Get status symbol based on bookmark status
 */
function getStatusSymbol(status: string): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'processing':
      return '◐';
    case 'complete':
      return '●';
    case 'error':
      return '✕';
    default:
      return '○';
  }
}

// =====================================================================
// DETAIL PANEL
// =====================================================================

async function showBookmarkDetail(bookmarkId: string) {
  selectedBookmarkId = bookmarkId;

  try {
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) {
      alert('Bookmark not found');
      return;
    }

    const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
    const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();
    const tags = await getBookmarkTags(bookmarkId);
    const allAvailableTags = await getAllTags();

    // Create detail panel
    const panel = createDetailPanel({
      bookmark,
      markdown,
      qaPairs,
      onClose: closeDetailPanel,
      onDelete: handleDeleteBookmark,
      onExport: handleExportBookmark,
      onDebugHtml: handleDebugHtml
    });

    // Replace tags placeholder with tag editor
    const tagsPlaceholder = panel.querySelector('.detail-panel__tags-placeholder');
    if (tagsPlaceholder && tagsPlaceholder.parentElement) {
      const tagEditor = createTagEditor({
        bookmarkId,
        initialTags: tags,
        allAvailableTags,
        onChange: (updatedTags) => {
          // Reload bookmarks to update tag counts in sidebar
          loadBookmarks();
        }
      });
      tagsPlaceholder.parentElement.replaceChild(tagEditor, tagsPlaceholder);
    }

    // Show panel
    detailPanelContainer.innerHTML = '';
    detailPanelContainer.appendChild(panel);
    detailPanelContainer.classList.add('library-detail-panel--visible');

    // Update selected card
    renderBookmarkList();

  } catch (error) {
    console.error('Error showing bookmark detail:', error);
    alert('Failed to load bookmark details');
  }
}

function closeDetailPanel() {
  selectedBookmarkId = null;
  detailPanelContainer.classList.remove('library-detail-panel--visible');
  detailPanelContainer.innerHTML = '';

  // Update UI to remove selection
  renderBookmarkList();
}

// =====================================================================
// BOOKMARK OPERATIONS
// =====================================================================

async function handleDeleteBookmark(bookmarkId: string) {
  try {
    // Delete associated records
    await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
    await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
    await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).delete();
    await db.bookmarks.delete(bookmarkId);

    closeDetailPanel();
    await loadBookmarks();

  } catch (error) {
    console.error('Error deleting bookmark:', error);
    alert('Failed to delete bookmark');
  }
}

async function handleExportBookmark(bookmark: Bookmark) {
  try {
    const exportData = await exportSingleBookmark(bookmark.id);
    downloadExport(exportData);
  } catch (error) {
    console.error('Error exporting bookmark:', error);
    alert('Failed to export bookmark');
  }
}

function handleDebugHtml(bookmark: Bookmark) {
  // Show the raw HTML in a modal-style overlay
  const debugOverlay = document.createElement('div');
  debugOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  const debugContent = document.createElement('div');
  debugContent.style.cssText = `
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: 8px;
    padding: 20px;
    max-width: 90%;
    max-height: 90%;
    overflow: auto;
    position: relative;
  `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.className = 'btn btn-secondary';
  closeBtn.style.cssText = `
    position: sticky;
    top: 0;
    margin-bottom: 10px;
  `;
  closeBtn.addEventListener('click', () => debugOverlay.remove());

  const htmlInfo = document.createElement('div');
  htmlInfo.style.cssText = 'margin-bottom: 10px; font-weight: bold;';
  htmlInfo.appendChild(createElement('div', {
    textContent: `Raw HTML Length: ${bookmark.html.length} characters`
  }));
  htmlInfo.appendChild(createElement('div', {
    textContent: `Status: ${bookmark.status}`
  }));
  if (bookmark.errorMessage) {
    htmlInfo.appendChild(createElement('div', {
      textContent: `Error: ${bookmark.errorMessage}`,
      style: { color: 'var(--error-text)' }
    }));
  }

  const htmlDisplay = document.createElement('pre');
  htmlDisplay.style.cssText = `
    white-space: pre-wrap;
    word-wrap: break-word;
    background: var(--bg-code);
    color: var(--text-primary);
    padding: 10px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    max-height: 70vh;
    overflow: auto;
    border: 1px solid var(--border-primary);
  `;
  htmlDisplay.textContent = bookmark.html || '(empty)';

  debugContent.appendChild(closeBtn);
  debugContent.appendChild(htmlInfo);
  debugContent.appendChild(htmlDisplay);
  debugOverlay.appendChild(debugContent);
  document.body.appendChild(debugOverlay);
}

// =====================================================================
// KEYBOARD SHORTCUTS
// =====================================================================

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selectedBookmarkId) {
    closeDetailPanel();
  }
});

// =====================================================================
// START
// =====================================================================

init();
