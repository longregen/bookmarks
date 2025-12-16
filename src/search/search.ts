import { db, BookmarkTag, QuestionAnswer, SearchHistory } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';
import { loadTagFilters } from '../lib/tag-filter';
import {
  SEARCH_HISTORY_LIMIT,
  SEARCH_AUTOCOMPLETE_LIMIT,
  SEARCH_TOP_K_RESULTS
} from '../lib/constants';

let selectedTags: Set<string> = new Set();
let selectedStatuses: Set<string> = new Set(['complete', 'pending', 'processing', 'error']);

const tagFilters = document.getElementById('tagFilters')!;
const statusFilters = document.getElementById('statusFilters')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const autocompleteDropdown = document.getElementById('autocompleteDropdown')!;
const resultsList = document.getElementById('resultsList')!;
const resultCount = document.getElementById('resultCount')!;

// Initialize bookmark detail manager
const detailManager = new BookmarkDetailManager({
  detailPanel: document.getElementById('detailPanel')!,
  detailBackdrop: document.getElementById('detailBackdrop')!,
  detailContent: document.getElementById('detailContent')!,
  closeBtn: document.getElementById('closeDetailBtn') as HTMLButtonElement,
  deleteBtn: document.getElementById('deleteBtn') as HTMLButtonElement,
  exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
  debugBtn: document.getElementById('debugBtn') as HTMLButtonElement,
  onDelete: () => performSearch(),
  onTagsChange: () => loadFilters()
});

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });
searchInput.addEventListener('input', showAutocomplete);
searchInput.addEventListener('focus', showAutocomplete);
searchInput.addEventListener('blur', () => setTimeout(hideAutocomplete, 200));

async function getSearchAutocompleteSetting(): Promise<boolean> {
  const setting = await db.settings.get('searchAutocomplete');
  return setting?.value ?? true;
}

async function saveSearchHistory(query: string, resultCount: number) {
  try {
    const id = crypto.randomUUID();
    const createdAt = new Date();

    await db.searchHistory.add({
      id,
      query,
      resultCount,
      createdAt,
    });

    const allHistory = await db.searchHistory.orderBy('createdAt').toArray();
    if (allHistory.length > SEARCH_HISTORY_LIMIT) {
      const toDelete = allHistory.slice(0, allHistory.length - SEARCH_HISTORY_LIMIT);
      await Promise.all(toDelete.map(h => db.searchHistory.delete(h.id)));
    }
  } catch (error) {
    console.error('Failed to save search history:', error);
  }
}

async function showAutocomplete() {
  const autocompleteEnabled = await getSearchAutocompleteSetting();
  if (!autocompleteEnabled) {
    hideAutocomplete();
    return;
  }

  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    hideAutocomplete();
    return;
  }

  const allHistory = await db.searchHistory
    .orderBy('createdAt')
    .reverse()
    .toArray();

  const matchingHistory = allHistory.filter(h =>
    h.query.toLowerCase().includes(query) && h.query.toLowerCase() !== query
  ).slice(0, SEARCH_AUTOCOMPLETE_LIMIT);

  if (!matchingHistory.length) {
    hideAutocomplete();
    return;
  }

  autocompleteDropdown.innerHTML = '';

  for (const history of matchingHistory) {
    const item = createElement('div', { className: 'autocomplete-item' });

    const querySpan = createElement('span', {
      className: 'autocomplete-query',
      textContent: history.query
    });

    const countSpan = createElement('span', {
      className: 'autocomplete-count',
      textContent: `${history.resultCount} result${history.resultCount !== 1 ? 's' : ''}`
    });

    item.appendChild(querySpan);
    item.appendChild(countSpan);

    item.onclick = () => {
      searchInput.value = history.query;
      hideAutocomplete();
      performSearch();
    };

    autocompleteDropdown.appendChild(item);
  }

  autocompleteDropdown.classList.add('active');
}

function hideAutocomplete() {
  autocompleteDropdown.classList.remove('active');
}

async function loadFilters() {
  // Load tag filters using shared utility
  await loadTagFilters({
    container: tagFilters,
    selectedTags,
    onChange: () => loadFilters()
  });

  // Load status filters
  statusFilters.innerHTML = '';
  const statusAll = createElement('label', { className: 'filter-item' });
  const statusAllCb = createElement('input', { attributes: { type: 'checkbox', checked: selectedStatuses.size === 4 ? 'checked' : '' } }) as HTMLInputElement;
  statusAllCb.onchange = () => { selectedStatuses = new Set(['complete', 'pending', 'processing', 'error']); loadFilters(); };
  statusAll.appendChild(statusAllCb);
  statusAll.appendChild(createElement('span', { textContent: 'Select all' }));
  statusFilters.appendChild(statusAll);

  for (const status of ['complete', 'pending', 'error']) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', { attributes: { type: 'checkbox', checked: selectedStatuses.has(status) ? 'checked' : '' } }) as HTMLInputElement;
    cb.onchange = () => { if (cb.checked) selectedStatuses.add(status); else selectedStatuses.delete(status); };
    label.appendChild(cb);
    label.appendChild(createElement('span', { textContent: status.charAt(0).toUpperCase() + status.slice(1) }));
    statusFilters.appendChild(label);
  }
}

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    resultsList.innerHTML = '';
    resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'Enter a search query' }));
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';

  try {
    const [queryEmbedding] = await generateEmbeddings([query]);
    if (!queryEmbedding?.length) throw new Error('Failed to generate embedding');

    // Load Q&A pairs - for semantic search we need embeddings to compute similarity
    // Note: A production system would use a vector database with indexed similarity search
    const allQAs = await db.questionsAnswers.toArray();
    const items = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' }
    ]).filter(({ embedding }) => Array.isArray(embedding) && embedding.length === queryEmbedding.length);

    if (!items.length) {
      resultsList.innerHTML = '';
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No embeddings found' }));
      return;
    }

    const topResults = findTopK(queryEmbedding, items, SEARCH_TOP_K_RESULTS);
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      const bookmarkId = result.item.bookmarkId;
      if (!bookmarkMap.has(bookmarkId)) bookmarkMap.set(bookmarkId, []);
      bookmarkMap.get(bookmarkId)!.push({ qa: result.item, score: result.score });
    }

    const sortedResults = Array.from(bookmarkMap.entries())
      .sort((a, b) => Math.max(...b[1].map(r => r.score)) - Math.max(...a[1].map(r => r.score)));

    // Batch load bookmarks and tags to avoid N+1 query pattern
    const bookmarkIds = sortedResults.map(([bookmarkId]) => bookmarkId);
    const bookmarks = await db.bookmarks.bulkGet(bookmarkIds);
    const bookmarksById = new Map(bookmarks.filter(Boolean).map(b => [b!.id, b!]));

    const allTags = await db.bookmarkTags.where('bookmarkId').anyOf(bookmarkIds).toArray();
    const tagsByBookmarkId = new Map<string, BookmarkTag[]>();
    for (const tag of allTags) {
      if (!tagsByBookmarkId.has(tag.bookmarkId)) {
        tagsByBookmarkId.set(tag.bookmarkId, []);
      }
      tagsByBookmarkId.get(tag.bookmarkId)!.push(tag);
    }

    const filteredResults = [];
    for (const [bookmarkId, qaResults] of sortedResults) {
      const bookmark = bookmarksById.get(bookmarkId);
      if (!bookmark || !selectedStatuses.has(bookmark.status)) continue;

      if (selectedTags.size > 0) {
        const tags = tagsByBookmarkId.get(bookmarkId) || [];
        if (!tags.some((t: BookmarkTag) => selectedTags.has(t.tagName))) continue;
      }

      filteredResults.push({ bookmark, qaResults });
    }

    resultCount.textContent = filteredResults.length.toString();
    resultsList.innerHTML = '';

    if (!filteredResults.length) {
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No results found' }));
      await saveSearchHistory(query, 0);
      return;
    }

    await saveSearchHistory(query, filteredResults.length);

    for (const { bookmark, qaResults } of filteredResults) {
      const maxScore = Math.max(...qaResults.map(r => r.score));
      const bestQA = qaResults[0].qa;

      const card = createElement('div', { className: 'result-card' });
      card.onclick = () => detailManager.showDetail(bookmark.id);

      card.appendChild(createElement('div', { className: 'relevance', textContent: `${(maxScore * 100).toFixed(0)}% match` }));
      card.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));

      const meta = createElement('div', { className: 'card-meta' });
      const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
      url.onclick = (e) => e.stopPropagation();
      meta.appendChild(url);
      meta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)}`));
      card.appendChild(meta);

      const qaPreview = createElement('div', { className: 'qa-preview' });
      qaPreview.appendChild(createElement('div', { className: 'qa-q', textContent: `Q: ${bestQA.question}` }));
      qaPreview.appendChild(createElement('div', { className: 'qa-a', textContent: `A: ${bestQA.answer}` }));
      card.appendChild(qaPreview);

      resultsList.appendChild(card);
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '';
    resultsList.appendChild(createElement('div', { className: 'error-message', textContent: `Search failed: ${error}` }));
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Search';
  }
}

initTheme();
onThemeChange((theme) => applyTheme(theme));
loadFilters();

// Initialize health indicator
const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}
