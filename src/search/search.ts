/**
 * Search Page
 *
 * Semantic search with filters for tags and status.
 * Uses embeddings to find relevant Q&A pairs and displays matching bookmarks.
 */

import { db } from '../db/schema.js';
import type { Bookmark, QuestionAnswer, Markdown } from '../db/schema.js';
import { createElement } from '../lib/dom.js';
import { generateEmbeddings } from '../lib/api.js';
import { findTopK } from '../lib/similarity.js';
import { formatDateByAge } from '../lib/date-format.js';
import { createHeaderNav, injectHeaderNavStyles } from '../shared/header-nav.js';
import { createDetailPanel, injectDetailPanelStyles } from '../shared/detail-panel.js';
import { createFilterSidebar, injectFilterSidebarStyles } from '../shared/filter-sidebar.js';
import {
  injectHealthIndicatorStyles,
  createDiagnosticsModal
} from '../shared/health-indicator.js';

// DOM elements
let searchInput: HTMLInputElement;
let searchBtn: HTMLButtonElement;
let searchResults: HTMLElement;
let resultCount: HTMLElement;
let sortSelect: HTMLSelectElement;
let filterSidebar: HTMLElement;
let detailPanel: HTMLElement;

// State
interface SearchResult {
  bookmarkId: string;
  bookmark: Bookmark;
  qaResults: Array<{ qa: QuestionAnswer; score: number }>;
}

let currentSearchResults: SearchResult[] = [];
let selectedBookmarkId: string | null = null;
let availableTags: string[] = [];
let selectedTags: string[] = [];  // empty = all selected
let selectedStatuses: string[] = [];  // empty = all selected

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  // Inject shared styles
  injectHeaderNavStyles();
  injectDetailPanelStyles();
  injectFilterSidebarStyles();
  injectHealthIndicatorStyles();

  // Create header navigation
  const headerNav = createHeaderNav({
    activePage: 'search',
    onHealthClick: () => {
      const modal = createDiagnosticsModal(() => {
        modal.remove();
      });
      document.body.appendChild(modal);
    }
  });
  document.getElementById('headerNav')!.appendChild(headerNav);

  // Get DOM elements
  searchInput = document.getElementById('searchInput') as HTMLInputElement;
  searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
  searchResults = document.getElementById('searchResults') as HTMLElement;
  resultCount = document.getElementById('resultCount') as HTMLElement;
  sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;
  filterSidebar = document.getElementById('filterSidebar') as HTMLElement;
  detailPanel = document.getElementById('detailPanel') as HTMLElement;

  // Load available tags
  await loadAvailableTags();

  // Render filter sidebar
  renderFilterSidebar();

  // Event listeners
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  sortSelect.addEventListener('change', () => {
    sortAndRenderResults();
  });

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Search Page] Initialized');
  }
});

/**
 * Load all available tags from database
 */
async function loadAvailableTags(): Promise<void> {
  const tags = await db.bookmarkTags.toArray();
  const uniqueTags = new Set(tags.map(t => t.tagName));
  availableTags = Array.from(uniqueTags).sort();

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Search Page] Loaded tags', { count: availableTags.length, tags: availableTags });
  }
}

/**
 * Render the filter sidebar
 */
function renderFilterSidebar(): void {
  filterSidebar.textContent = '';

  const sidebar = createFilterSidebar({
    mode: 'search',
    availableTags,
    selectedTags,
    availableStatuses: ['complete', 'pending', 'error'],
    selectedStatuses,
    onTagFilterChange: (newSelectedTags) => {
      selectedTags = newSelectedTags;
      applyFiltersToResults();
    },
    onStatusFilterChange: (newSelectedStatuses) => {
      selectedStatuses = newSelectedStatuses;
      applyFiltersToResults();
    }
  });

  filterSidebar.appendChild(sidebar);
}

/**
 * Perform semantic search
 */
async function performSearch(): Promise<void> {
  const query = searchInput.value.trim();

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Search] Starting search', { query, queryLength: query.length });
  }

  if (!query) {
    searchResults.textContent = '';
    searchResults.appendChild(createElement('div', {
      className: 'empty-state',
      textContent: 'Enter a search query to find bookmarks'
    }));
    return;
  }

  try {
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';

    // Reset state
    currentSearchResults = [];
    selectedBookmarkId = null;
    detailPanel.textContent = '';

    // Generate embedding for the query
    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Generating query embedding...');
    }
    const [queryEmbedding] = await generateEmbeddings([query]);

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Query embedding received', {
        exists: !!queryEmbedding,
        isArray: Array.isArray(queryEmbedding),
        dimension: queryEmbedding?.length,
        sample: queryEmbedding?.slice(0, 5),
      });
    }

    if (!queryEmbedding || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.error('[Search] Invalid query embedding received!');
      }
      searchResults.textContent = '';
      searchResults.appendChild(createElement('div', {
        className: 'error-message',
        textContent: 'Failed to generate query embedding'
      }));
      return;
    }

    // Load all Q&A pairs with embeddings
    const allQAs = await db.questionsAnswers.toArray();

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Loaded Q&A pairs from database', {
        totalCount: allQAs.length,
        withQuestionEmbedding: allQAs.filter(qa => Array.isArray(qa.embeddingQuestion) && qa.embeddingQuestion.length > 0).length,
        withBothEmbedding: allQAs.filter(qa => Array.isArray(qa.embeddingBoth) && qa.embeddingBoth.length > 0).length,
      });
    }

    if (allQAs.length === 0) {
      searchResults.textContent = '';
      searchResults.appendChild(createElement('div', {
        className: 'empty-state',
        textContent: 'No processed bookmarks to search yet'
      }));
      return;
    }

    // Find top K similar Q&A pairs using both question and combined embeddings
    const allItems = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' },
    ]);

    // Filter out items with missing or invalid embeddings
    const items = allItems.filter(({ embedding }) => {
      return Array.isArray(embedding) &&
             embedding.length > 0 &&
             embedding.length === queryEmbedding.length;
    });

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Created items for comparison', {
        totalItems: allItems.length,
        validItems: items.length,
      });
    }

    if (items.length === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.error('[Search] No valid items after filtering!');
      }
      searchResults.textContent = '';
      searchResults.appendChild(createElement('div', {
        className: 'empty-state',
        textContent: 'No valid embeddings found. Try reprocessing your bookmarks.'
      }));
      return;
    }

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Running similarity search on', items.length, 'items');
    }

    // Get top results
    const topResults = findTopK(queryEmbedding, items, 200);

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Top results from findTopK', {
        resultCount: topResults.length,
        scores: topResults.map(r => r.score.toFixed(4)),
        scoreRange: topResults.length > 0 ? {
          min: Math.min(...topResults.map(r => r.score)).toFixed(4),
          max: Math.max(...topResults.map(r => r.score)).toFixed(4),
        } : null,
      });
    }

    // Group by bookmark and get unique bookmarks
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      const bookmarkId = result.item.bookmarkId;
      if (!bookmarkMap.has(bookmarkId)) {
        bookmarkMap.set(bookmarkId, []);
      }
      bookmarkMap.get(bookmarkId)!.push({ qa: result.item, score: result.score });
    }

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Grouped results by bookmark', {
        uniqueBookmarks: bookmarkMap.size,
        totalMatches: [...bookmarkMap.values()].reduce((sum, arr) => sum + arr.length, 0),
      });
    }

    if (bookmarkMap.size === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.log('[Search] No results found');
      }
      searchResults.textContent = '';
      searchResults.appendChild(createElement('div', {
        className: 'empty-state',
        textContent: 'No results found'
      }));
      resultCount.textContent = '0';
      return;
    }

    // Build sorted results array
    const sortedEntries = [...bookmarkMap.entries()].sort((a, b) => {
      const maxScoreA = Math.max(...a[1].map(r => r.score));
      const maxScoreB = Math.max(...b[1].map(r => r.score));
      return maxScoreB - maxScoreA;
    });

    // Fetch bookmark data and build results array
    for (const [bookmarkId, qaResults] of sortedEntries) {
      const bookmark = await db.bookmarks.get(bookmarkId);
      if (!bookmark) continue;

      currentSearchResults.push({
        bookmarkId,
        bookmark,
        qaResults,
      });
    }

    // Store search in history
    await storeSearchHistory(query, currentSearchResults.length);

    // Apply filters and render
    applyFiltersToResults();

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Search completed successfully', {
        totalResults: currentSearchResults.length,
      });
    }
  } catch (error) {
    console.error('[Search] Error performing search:', error);
    searchResults.textContent = '';
    searchResults.appendChild(createElement('div', {
      className: 'error-message',
      textContent: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }));
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '';
    searchBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
}

/**
 * Apply filters to search results and render
 */
async function applyFiltersToResults(): Promise<void> {
  let filteredResults = [...currentSearchResults];

  // Apply tag filter
  if (selectedTags.length > 0) {
    const bookmarkIdsWithSelectedTags = new Set<string>();

    for (const tag of selectedTags) {
      const bookmarkTags = await db.bookmarkTags
        .where('tagName')
        .equals(tag)
        .toArray();

      bookmarkTags.forEach(bt => bookmarkIdsWithSelectedTags.add(bt.bookmarkId));
    }

    filteredResults = filteredResults.filter(result =>
      bookmarkIdsWithSelectedTags.has(result.bookmarkId)
    );
  }

  // Apply status filter
  if (selectedStatuses.length > 0) {
    filteredResults = filteredResults.filter(result =>
      selectedStatuses.includes(result.bookmark.status)
    );
  }

  // Store filtered results for sorting
  const filteredResultsToRender = filteredResults;

  // Update count
  resultCount.textContent = filteredResultsToRender.length.toString();

  // Render results with current sort
  renderResults(filteredResultsToRender);
}

/**
 * Sort and render results based on selected sort option
 */
function sortAndRenderResults(): void {
  applyFiltersToResults();
}

/**
 * Render search results
 */
async function renderResults(results: SearchResult[]): Promise<void> {
  // Sort results
  const sortValue = sortSelect.value;
  const sortedResults = [...results];

  if (sortValue === 'relevance') {
    // Already sorted by relevance from search
  } else if (sortValue === 'date-desc') {
    sortedResults.sort((a, b) =>
      new Date(b.bookmark.createdAt).getTime() - new Date(a.bookmark.createdAt).getTime()
    );
  } else if (sortValue === 'date-asc') {
    sortedResults.sort((a, b) =>
      new Date(a.bookmark.createdAt).getTime() - new Date(b.bookmark.createdAt).getTime()
    );
  }

  // Clear results
  searchResults.textContent = '';

  if (sortedResults.length === 0) {
    searchResults.appendChild(createElement('div', {
      className: 'empty-state',
      textContent: 'No results match your filters'
    }));
    return;
  }

  // Render each result
  for (const result of sortedResults) {
    const card = await createSearchResultCard(result);
    searchResults.appendChild(card);
  }
}

/**
 * Create a search result card
 */
async function createSearchResultCard(result: SearchResult): Promise<HTMLElement> {
  const { bookmark, qaResults } = result;

  // Get best matching Q&A
  const bestMatch = qaResults.reduce((best, current) =>
    current.score > best.score ? current : best
  );
  const relevancePercent = Math.round(bestMatch.score * 100);

  // Get tags for this bookmark
  const tags = await db.bookmarkTags
    .where('bookmarkId')
    .equals(bookmark.id)
    .toArray();

  const card = createElement('div', {
    className: `search-result-card${selectedBookmarkId === bookmark.id ? ' search-result-card--selected' : ''}`
  });

  // Title row with relevance and status
  const titleRow = createElement('div', { className: 'search-result-card__title-row' });

  const relevanceBadge = createElement('div', {
    className: 'search-result-card__relevance',
    textContent: `${relevancePercent}%`
  });

  const title = createElement('h3', {
    className: 'search-result-card__title',
    textContent: bookmark.title
  });

  const statusSymbol = createElement('span', {
    className: `search-result-card__status search-result-card__status--${bookmark.status}`,
    textContent: getStatusSymbol(bookmark.status)
  });

  titleRow.appendChild(relevanceBadge);
  titleRow.appendChild(title);
  titleRow.appendChild(statusSymbol);

  // Meta row (URL, tags, date)
  const metaRow = createElement('div', { className: 'search-result-card__meta' });

  const url = new URL(bookmark.url).hostname;
  const metaParts: HTMLElement[] = [];

  metaParts.push(createElement('span', {
    className: 'search-result-card__url',
    textContent: url
  }));

  if (tags.length > 0) {
    metaParts.push(createElement('span', {
      className: 'search-result-card__separator',
      textContent: '·'
    }));

    const tagsSpan = createElement('span', { className: 'search-result-card__tags' });
    tags.slice(0, 3).forEach((tag, i) => {
      if (i > 0) tagsSpan.appendChild(document.createTextNode(' '));
      tagsSpan.appendChild(createElement('span', { textContent: `#${tag.tagName}` }));
    });
    metaParts.push(tagsSpan);
  }

  metaParts.push(createElement('span', {
    className: 'search-result-card__separator',
    textContent: '·'
  }));

  metaParts.push(createElement('span', {
    className: 'search-result-card__date',
    textContent: formatDateByAge(bookmark.createdAt)
  }));

  metaParts.forEach(part => metaRow.appendChild(part));

  // Q&A preview
  const qaPreview = createElement('div', { className: 'search-result-card__qa' });

  const question = createElement('div', { className: 'search-result-card__question' });
  question.appendChild(createElement('strong', { textContent: 'Q: ' }));
  question.appendChild(document.createTextNode(bestMatch.qa.question));

  const answer = createElement('div', { className: 'search-result-card__answer' });
  answer.appendChild(createElement('strong', { textContent: 'A: ' }));
  answer.appendChild(document.createTextNode(bestMatch.qa.answer));

  qaPreview.appendChild(question);
  qaPreview.appendChild(answer);

  // Assemble card
  card.appendChild(titleRow);
  card.appendChild(metaRow);
  card.appendChild(qaPreview);

  // Click handler
  card.addEventListener('click', () => {
    openDetailPanel(bookmark.id);
  });

  return card;
}

/**
 * Open detail panel for a bookmark
 */
async function openDetailPanel(bookmarkId: string): Promise<void> {
  selectedBookmarkId = bookmarkId;

  // Update selected state on cards
  searchResults.querySelectorAll('.search-result-card').forEach(card => {
    card.classList.remove('search-result-card--selected');
  });
  const selectedCard = Array.from(searchResults.querySelectorAll('.search-result-card'))
    .find(card => {
      const titleEl = card.querySelector('.search-result-card__title');
      return titleEl && searchResults.contains(card);
    });

  // Re-render results to update selection
  const currentFilteredResults = await getFilteredResults();
  renderResults(currentFilteredResults);

  // Fetch bookmark data
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) return;

  const markdown = await db.markdown
    .where('bookmarkId')
    .equals(bookmarkId)
    .first();

  const qaPairs = await db.questionsAnswers
    .where('bookmarkId')
    .equals(bookmarkId)
    .toArray();

  // Create detail panel
  detailPanel.textContent = '';
  const panel = createDetailPanel({
    bookmark,
    markdown,
    qaPairs,
    onClose: () => {
      selectedBookmarkId = null;
      detailPanel.textContent = '';
      // Update selected state on cards
      searchResults.querySelectorAll('.search-result-card').forEach(card => {
        card.classList.remove('search-result-card--selected');
      });
    },
    onDelete: async (id) => {
      await deleteBookmark(id);
      selectedBookmarkId = null;
      detailPanel.textContent = '';
      // Re-run search
      performSearch();
    },
    onExport: exportBookmark,
    onDebugHtml: debugBookmarkHtml,
  });

  detailPanel.appendChild(panel);
}

/**
 * Get currently filtered results
 */
async function getFilteredResults(): Promise<SearchResult[]> {
  let filteredResults = [...currentSearchResults];

  // Apply tag filter
  if (selectedTags.length > 0) {
    const bookmarkIdsWithSelectedTags = new Set<string>();

    for (const tag of selectedTags) {
      const bookmarkTags = await db.bookmarkTags
        .where('tagName')
        .equals(tag)
        .toArray();

      bookmarkTags.forEach(bt => bookmarkIdsWithSelectedTags.add(bt.bookmarkId));
    }

    filteredResults = filteredResults.filter(result =>
      bookmarkIdsWithSelectedTags.has(result.bookmarkId)
    );
  }

  // Apply status filter
  if (selectedStatuses.length > 0) {
    filteredResults = filteredResults.filter(result =>
      selectedStatuses.includes(result.bookmark.status)
    );
  }

  return filteredResults;
}

/**
 * Delete a bookmark
 */
async function deleteBookmark(bookmarkId: string): Promise<void> {
  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Search] Deleting bookmark', { bookmarkId });
  }

  await db.bookmarks.delete(bookmarkId);
  await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
  await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
  await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).delete();
}

/**
 * Export a bookmark
 */
function exportBookmark(bookmark: Bookmark): void {
  const data = {
    url: bookmark.url,
    title: bookmark.title,
    createdAt: bookmark.createdAt,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmark-${bookmark.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Debug bookmark HTML
 */
function debugBookmarkHtml(bookmark: Bookmark): void {
  const blob = new Blob([bookmark.html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

/**
 * Store search in history
 */
async function storeSearchHistory(query: string, resultCount: number): Promise<void> {
  try {
    await db.searchHistory.add({
      id: crypto.randomUUID(),
      query,
      resultCount,
      createdAt: new Date(),
    });

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Stored search in history', { query, resultCount });
    }
  } catch (error) {
    console.error('[Search] Failed to store search history:', error);
  }
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
