import { db, Bookmark, QuestionAnswer } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { createHeaderNav, injectHeaderNavStyles } from '../shared/header-nav';
import { createDetailPanel, injectDetailPanelStyles } from '../shared/detail-panel';
import { createFilterSidebar, injectFilterSidebarStyles } from '../shared/filter-sidebar';
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

interface StumbleItem {
  bookmark: Bookmark;
  tags: string[];
  qa?: QuestionAnswer;
}

let allTags: string[] = [];
let selectedTags: string[] = []; // empty = select all
let stumbleItems: StumbleItem[] = [];
let selectedBookmarkId: string | null = null;
const STUMBLE_COUNT = 10;

// =====================================================================
// DOM ELEMENTS
// =====================================================================

const headerNavContainer = document.getElementById('headerNav') as HTMLDivElement;
const filterSidebarContainer = document.getElementById('filterSidebar') as HTMLElement;
const stumbleListContainer = document.getElementById('stumbleList') as HTMLDivElement;
const detailPanelContainer = document.getElementById('detailPanel') as HTMLDivElement;
const stumbleCountEl = document.getElementById('stumbleCount') as HTMLSpanElement;
const shuffleButton = document.getElementById('shuffleButton') as HTMLButtonElement;

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
    activePage: 'stumble',
    onHealthClick: () => {
      const modal = createDiagnosticsModal(() => {
        modal.remove();
      });
      document.body.appendChild(modal);
    }
  });
  headerNavContainer.appendChild(headerNav);

  // Load initial data
  await loadAllTags();
  await loadStumbleBookmarks();

  // Render UI
  renderFilterSidebar();
  renderStumbleCards();

  // Set up event listeners
  shuffleButton.addEventListener('click', handleShuffle);

  // Refresh periodically to detect new bookmarks
  setInterval(async () => {
    await loadAllTags();
    renderFilterSidebar();
  }, 5000);
}

// =====================================================================
// DATA LOADING
// =====================================================================

async function loadAllTags() {
  try {
    const tags = await getAllTags();
    allTags = tags.sort();
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

async function loadStumbleBookmarks() {
  try {
    const items = await getStumbleBookmarks(selectedTags, STUMBLE_COUNT);
    stumbleItems = items;
  } catch (error) {
    console.error('Error loading stumble bookmarks:', error);
    stumbleListContainer.innerHTML = '';
    stumbleListContainer.appendChild(
      createElement('div', {
        className: 'error-message',
        textContent: 'Failed to load bookmarks'
      })
    );
  }
}

/**
 * Get random bookmarks using Fisher-Yates shuffle
 * Based on algorithm from REDESIGN.md
 */
async function getStumbleBookmarks(
  selectedTags: string[],
  count: number = 10
): Promise<StumbleItem[]> {
  let bookmarks = await db.bookmarks
    .where('status').equals('complete')
    .toArray();

  // Filter by selected tags if any
  if (selectedTags.length > 0) {
    const taggedBookmarkIds = await db.bookmarkTags
      .where('tagName').anyOf(selectedTags)
      .primaryKeys()
      .then(keys => [...new Set(keys.map(k => k[0]))]);
    bookmarks = bookmarks.filter(b => taggedBookmarkIds.includes(b.id));
  }

  // Fisher-Yates shuffle
  for (let i = bookmarks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bookmarks[i], bookmarks[j]] = [bookmarks[j], bookmarks[i]];
  }

  const selected = bookmarks.slice(0, count);

  // Get tags and one random Q&A for each
  return Promise.all(selected.map(async (bookmark) => {
    const tags = await getBookmarkTags(bookmark.id);
    const qaPairs = await db.questionsAnswers
      .where('bookmarkId').equals(bookmark.id)
      .toArray();
    const randomQA = qaPairs.length > 0
      ? qaPairs[Math.floor(Math.random() * qaPairs.length)]
      : undefined;
    return { bookmark, tags, qa: randomQA };
  }));
}

// =====================================================================
// FILTERING
// =====================================================================

async function handleTagFilterChange(newSelectedTags: string[]) {
  selectedTags = newSelectedTags;
  await loadStumbleBookmarks();
  renderStumbleCards();
  closeDetailPanel();
}

async function handleShuffle() {
  // Add animation effect
  shuffleButton.classList.add('stumble-shuffle-btn--spinning');
  setTimeout(() => {
    shuffleButton.classList.remove('stumble-shuffle-btn--spinning');
  }, 600);

  await loadStumbleBookmarks();
  renderStumbleCards();
  closeDetailPanel();
}

// =====================================================================
// FILTER SIDEBAR RENDERING
// =====================================================================

function renderFilterSidebar() {
  const sidebar = createFilterSidebar({
    mode: 'stumble',
    availableTags: allTags,
    selectedTags,
    onTagFilterChange: handleTagFilterChange
  });

  filterSidebarContainer.innerHTML = '';
  filterSidebarContainer.appendChild(sidebar);
}

// =====================================================================
// STUMBLE CARDS RENDERING
// =====================================================================

function renderStumbleCards() {
  stumbleCountEl.textContent = stumbleItems.length.toString();

  // Clear list
  stumbleListContainer.innerHTML = '';

  if (stumbleItems.length === 0) {
    const emptyState = createElement('div', { className: 'empty-state' });
    emptyState.appendChild(
      createElement('div', {
        className: 'empty-state__title',
        textContent: selectedTags.length > 0
          ? 'No complete bookmarks with selected tags'
          : 'No complete bookmarks yet'
      })
    );
    emptyState.appendChild(
      createElement('div', {
        className: 'empty-state__description',
        textContent: selectedTags.length > 0
          ? 'Try selecting different tags or view all bookmarks'
          : 'Save some pages and wait for them to be processed!'
      })
    );
    stumbleListContainer.appendChild(emptyState);
    return;
  }

  // Render stumble cards
  stumbleItems.forEach(item => {
    const card = createStumbleCard(item);
    stumbleListContainer.appendChild(card);
  });
}

function createStumbleCard(item: StumbleItem): HTMLElement {
  const { bookmark, tags, qa } = item;

  const card = createElement('div', {
    className: `stumble-card${selectedBookmarkId === bookmark.id ? ' stumble-card--selected' : ''}`
  });

  // Title row (with status on right)
  const titleRow = createElement('div', { className: 'stumble-card__title-row' });

  const title = createElement('div', {
    className: 'stumble-card__title',
    textContent: bookmark.title
  });

  const statusSymbol = '●'; // Always complete
  const status = createElement('span', {
    className: 'stumble-card__status stumble-card__status--complete',
    textContent: statusSymbol
  });

  titleRow.appendChild(title);
  titleRow.appendChild(status);
  card.appendChild(titleRow);

  // Meta row (URL, time ago, tags)
  const metaRow = createElement('div', { className: 'stumble-card__meta' });

  // URL
  const url = new URL(bookmark.url);
  const urlSpan = createElement('span', {
    className: 'stumble-card__url',
    textContent: url.hostname
  });
  metaRow.appendChild(urlSpan);

  // Separator
  metaRow.appendChild(createElement('span', {
    className: 'stumble-card__separator',
    textContent: '·'
  }));

  // Tags
  if (tags.length > 0) {
    const tagsSpan = createElement('span', {
      className: 'stumble-card__tags',
      textContent: tags.map(t => `#${t}`).join(' ')
    });
    metaRow.appendChild(tagsSpan);
  }

  card.appendChild(metaRow);

  // Time ago row
  const timeRow = createElement('div', { className: 'stumble-card__time-row' });
  const timeAgo = formatDateByAge(bookmark.createdAt);
  const timeSpan = createElement('span', {
    className: 'stumble-card__time',
    textContent: `Saved ${timeAgo}`
  });
  timeRow.appendChild(timeSpan);
  card.appendChild(timeRow);

  // Q&A preview (one random Q&A)
  if (qa) {
    const qaPreview = createElement('div', { className: 'stumble-card__qa' });

    const question = createElement('div', { className: 'stumble-card__question' });
    question.appendChild(createElement('strong', { textContent: 'Q: ' }));
    question.appendChild(document.createTextNode(qa.question));
    qaPreview.appendChild(question);

    const answer = createElement('div', { className: 'stumble-card__answer' });
    answer.appendChild(createElement('strong', { textContent: 'A: ' }));

    // Truncate answer if too long
    const answerText = qa.answer.length > 120
      ? qa.answer.substring(0, 120) + '...'
      : qa.answer;
    answer.appendChild(document.createTextNode(answerText));
    qaPreview.appendChild(answer);

    card.appendChild(qaPreview);
  }

  // Click handler
  card.addEventListener('click', () => {
    showBookmarkDetail(bookmark.id);
  });

  return card;
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
        onChange: async (updatedTags) => {
          // Reload tags and stumble bookmarks to update filter sidebar
          await loadAllTags();
          renderFilterSidebar();
        }
      });
      tagsPlaceholder.parentElement.replaceChild(tagEditor, tagsPlaceholder);
    }

    // Show panel
    detailPanelContainer.innerHTML = '';
    detailPanelContainer.appendChild(panel);
    detailPanelContainer.classList.add('stumble-detail-panel--visible');

    // Update selected card
    renderStumbleCards();

  } catch (error) {
    console.error('Error showing bookmark detail:', error);
    alert('Failed to load bookmark details');
  }
}

function closeDetailPanel() {
  selectedBookmarkId = null;
  detailPanelContainer.classList.remove('stumble-detail-panel--visible');
  detailPanelContainer.innerHTML = '';

  // Update UI to remove selection
  renderStumbleCards();
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
    await loadStumbleBookmarks();
    renderStumbleCards();

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
