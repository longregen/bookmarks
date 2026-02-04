import { db, type BookmarkTag, type QuestionAnswer } from '../db/schema';
import { createElement, getElement, setSpinnerContent } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWeb } from '../web/init-web';
import { createHealthIndicator } from '../ui/health-indicator';
import { createSyncStatusIndicator } from '../ui/sync-status-indicator';
import { BookmarkDetailManager } from '../ui/bookmark-detail';
import { loadTagFilters } from '../ui/tag-filter';
import { config } from '../lib/config-registry';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { getErrorMessage } from '../lib/errors';
import { getSettings } from '../lib/settings';
import { ServerApiClient } from '../lib/server-api';

const selectedTags = new Set<string>();

const tagFilters = getElement('tagFilters');
const searchInput = getElement<HTMLInputElement>('searchInput');
const searchBtn = getElement<HTMLButtonElement>('searchBtn');
const autocompleteDropdown = getElement('autocompleteDropdown');
const resultsList = getElement('resultsList');
const resultStatus = getElement('resultStatus');
const searchPage = getElement('searchPage');
const searchHero = getElement('searchHero');
const resultHeader = getElement('resultHeader');

searchPage.classList.add('search-page--centered');

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
  onDelete: () => void performSearch(),
  onTagsChange: () => void loadFilters(),
  onRetry: () => void performSearch()
});

searchBtn.addEventListener('click', () => void performSearch());
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') void performSearch(); });
searchInput.addEventListener('input', () => void showAutocomplete());
searchInput.addEventListener('focus', () => void showAutocomplete());
searchInput.addEventListener('blur', () => setTimeout(hideAutocomplete, 200));

async function getSearchAutocompleteSetting(): Promise<boolean> {
  const setting = await db.settings.get('searchAutocomplete');
  return (setting?.value ?? true) as boolean;
}

async function saveSearchHistory(query: string, resultCount: number): Promise<void> {
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
    if (allHistory.length > config.SEARCH_HISTORY_LIMIT) {
      const toDelete = allHistory.slice(0, allHistory.length - config.SEARCH_HISTORY_LIMIT);
      await Promise.all(toDelete.map(h => db.searchHistory.delete(h.id)));
    }
  } catch (error) {
    console.error('Failed to save search history:', error);
  }
}

async function showAutocomplete(): Promise<void> {
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
  ).slice(0, config.SEARCH_AUTOCOMPLETE_LIMIT);

  if (!matchingHistory.length) {
    hideAutocomplete();
    return;
  }

  autocompleteDropdown.innerHTML = '';

  const fragment = document.createDocumentFragment();
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
      void performSearch();
    };

    fragment.appendChild(item);
  }
  autocompleteDropdown.appendChild(fragment);

  autocompleteDropdown.classList.add('active');
}

function hideAutocomplete(): void {
  autocompleteDropdown.classList.remove('active');
}

function buildResultCard(
  bookmark: { id: string; title: string; url: string; createdAt: Date },
  maxScore: number,
  bestQA: { question: string; answer: string },
  onClick: () => void
): HTMLElement {
  const card = createElement('div', { className: 'result-card' });
  card.onclick = onClick;

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

  return card;
}

async function loadFilters(): Promise<void> {
  await loadTagFilters({
    container: tagFilters,
    selectedTags,
    onChange: () => {
      void loadFilters();
      if (searchInput.value.trim()) {
        void performSearch();
      }
    }
  });
}

function showResultsMode(): void {
  searchPage.classList.remove('search-page--centered');
  searchHero.classList.add('hidden');
  resultHeader.classList.remove('hidden');
  setSpinnerContent(resultStatus, 'Searching...');
  resultStatus.classList.add('loading');
}

function showCenteredMode(): void {
  searchPage.classList.add('search-page--centered');
  searchHero.classList.remove('hidden');
  resultHeader.classList.add('hidden');
}

async function isServerSearchEnabled(): Promise<{ enabled: boolean; client?: ServerApiClient }> {
  try {
    const settings = await getSettings();
    if (settings.serverEnabled && settings.serverSessionToken && settings.serverUrl) {
      const client = new ServerApiClient(settings.serverUrl, settings.serverSessionToken);
      return { enabled: true, client };
    }
  } catch {
    // Fall back to local search
  }
  return { enabled: false };
}

interface ServerSearchResult {
  bookmark: { id: string; title: string; url: string; createdAt: Date };
  score: number;
  qa: { question: string; answer: string };
}

async function performServerSearch(client: ServerApiClient, query: string): Promise<ServerSearchResult[]> {
  const response = await client.semanticSearch({ query, limit: config.SEARCH_TOP_K_RESULTS });

  return response.results.map(result => ({
    bookmark: {
      id: result.bookmark.id,
      title: result.bookmark.title,
      url: result.bookmark.url,
      createdAt: new Date(result.bookmark.createdAt),
    },
    score: result.score,
    qa: {
      question: 'No preview available',
      answer: 'Open bookmark details to view content',
    },
  }));
}

async function renderServerResults(results: ServerSearchResult[], query: string): Promise<void> {
  // Filter by selected tags if any
  let filteredResults = results;
  if (selectedTags.size > 0) {
    const bookmarkIds = results.map(r => r.bookmark.id);
    const allTags = await db.bookmarkTags.where('bookmarkId').anyOf(bookmarkIds).toArray();
    const tagsByBookmarkId = new Map<string, string[]>();
    for (const tag of allTags) {
      const existing = tagsByBookmarkId.get(tag.bookmarkId);
      if (existing) {
        existing.push(tag.tagName);
      } else {
        tagsByBookmarkId.set(tag.bookmarkId, [tag.tagName]);
      }
    }
    filteredResults = results.filter(r => {
      const tags = tagsByBookmarkId.get(r.bookmark.id) ?? [];
      return tags.some(t => selectedTags.has(t));
    });
  }

  const count = filteredResults.length;
  resultStatus.classList.remove('loading');
  resultStatus.textContent = count === 0
    ? 'No results found'
    : `${count} result${count === 1 ? '' : 's'} (server)`;
  resultsList.innerHTML = '';

  if (!filteredResults.length) {
    resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'Try a different search term or check your filters' }));
    await saveSearchHistory(query, 0);
    return;
  }

  await saveSearchHistory(query, filteredResults.length);

  const fragment = document.createDocumentFragment();
  for (const { bookmark, score, qa } of filteredResults) {
    const card = buildResultCard(bookmark, score, qa, () => detailManager.showDetail(bookmark.id));
    fragment.appendChild(card);
  }
  resultsList.appendChild(fragment);
}

// eslint-disable-next-line complexity
async function performSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) {
    showCenteredMode();
    resultsList.innerHTML = '';
    return;
  }

  showResultsMode();
  searchBtn.disabled = true;

  try {
    // Check if server search is enabled
    const { enabled: serverEnabled, client } = await isServerSearchEnabled();

    if (serverEnabled && client) {
      try {
        const serverResults = await performServerSearch(client, query);

        if (serverResults.length > 0) {
          await renderServerResults(serverResults, query);
          return;
        }
        // If no results from server, fall through to local search
      } catch (serverError) {
        console.warn('Server search failed, falling back to local:', getErrorMessage(serverError));
        // Fall through to local search
      }
    }

    const [queryEmbedding] = await generateEmbeddings([query]);
    if (queryEmbedding.length === 0) throw new Error('Failed to generate embedding');

    const allQAs = await db.questionsAnswers.toArray();
    const items = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' }
    ]).filter(({ embedding }) => Array.isArray(embedding) && embedding.length === queryEmbedding.length);

    if (!items.length) {
      resultStatus.classList.remove('loading');
      resultStatus.textContent = 'No bookmarks indexed yet';
      resultsList.innerHTML = '';
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'Save some bookmarks first to enable search' }));
      return;
    }

    const topResults = findTopK(queryEmbedding, items, config.SEARCH_TOP_K_RESULTS);
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      const bookmarkId = result.item.bookmarkId;
      const existing = bookmarkMap.get(bookmarkId);
      if (existing) {
        existing.push({ qa: result.item, score: result.score });
      } else {
        bookmarkMap.set(bookmarkId, [{ qa: result.item, score: result.score }]);
      }
    }

    const resultsWithMax = Array.from(bookmarkMap.entries()).map(([id, results]) => ({
      bookmarkId: id,
      qaResults: results,
      maxScore: Math.max(...results.map(r => r.score))
    }));
    resultsWithMax.sort((a, b) => b.maxScore - a.maxScore);

    const bookmarkIds = resultsWithMax.map(r => r.bookmarkId);
    const bookmarks = await db.bookmarks.bulkGet(bookmarkIds);
    const bookmarksById = new Map(bookmarks.filter((b): b is NonNullable<typeof b> => b !== undefined).map(b => [b.id, b]));

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

    const filteredResults = [];
    for (const result of resultsWithMax) {
      const bookmark = bookmarksById.get(result.bookmarkId);
      if (!bookmark) continue;

      if (selectedTags.size > 0) {
        const tags = tagsByBookmarkId.get(result.bookmarkId) ?? [];
        if (!tags.some(t => selectedTags.has(t.tagName))) continue;
      }

      filteredResults.push({ bookmark, qaResults: result.qaResults, maxScore: result.maxScore });
    }

    const count = filteredResults.length;
    resultStatus.classList.remove('loading');
    resultStatus.textContent = count === 0
      ? 'No results found'
      : `${count} result${count === 1 ? '' : 's'}`;
    resultsList.innerHTML = '';

    if (!filteredResults.length) {
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'Try a different search term or check your filters' }));
      await saveSearchHistory(query, 0);
      return;
    }

    await saveSearchHistory(query, filteredResults.length);

    const fragment = document.createDocumentFragment();
    for (const { bookmark, qaResults, maxScore } of filteredResults) {
      const bestQA = qaResults[0].qa;

      const card = buildResultCard(bookmark, maxScore, bestQA, () => detailManager.showDetail(bookmark.id));
      fragment.appendChild(card);
    }
    resultsList.appendChild(fragment);
  } catch (error) {
    console.error('Search error:', error);
    resultStatus.classList.remove('loading');
    resultStatus.textContent = 'Search failed';
    resultsList.innerHTML = '';

    const errorMessage = getErrorMessage(error);
    const isApiKeyError = errorMessage.toLowerCase().includes('api key') ||
                          errorMessage.toLowerCase().includes('not configured') ||
                          errorMessage.toLowerCase().includes('401') ||
                          errorMessage.toLowerCase().includes('unauthorized');

    const errorDiv = createElement('div', { className: 'error-message' });

    if (isApiKeyError) {
      errorDiv.appendChild(document.createTextNode('API endpoint not configured. '));
      const settingsLink = createElement('a', {
        href: '../options/options.html',
        textContent: 'Configure in Settings',
        className: 'error-link'
      });
      errorDiv.appendChild(settingsLink);
    } else {
      errorDiv.appendChild(document.createTextNode(`${errorMessage} `));
      const settingsLink = createElement('a', {
        href: '../options/options.html',
        textContent: 'Check Settings',
        className: 'error-link'
      });
      errorDiv.appendChild(settingsLink);
    }

    resultsList.appendChild(errorDiv);
  } finally {
    searchBtn.disabled = false;
  }
}

if (__IS_WEB__) {
  void initWeb();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));
void loadFilters();

const urlParams = new URLSearchParams(window.location.search);
const initialQuery = urlParams.get('q');
if (initialQuery !== null && initialQuery !== '') {
  searchInput.value = initialQuery;
  void performSearch();
}

searchInput.focus();

const keydownHandler = (e: KeyboardEvent): void => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
};
document.addEventListener('keydown', keydownHandler);

let healthCleanup: (() => void) | null = null;
let syncCleanup: (() => void) | null = null;

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  healthCleanup = createHealthIndicator(healthIndicatorContainer);
}

const syncIndicatorContainer = document.getElementById('syncIndicator');
if (syncIndicatorContainer) {
  syncCleanup = createSyncStatusIndicator(syncIndicatorContainer, 'compact');
}

const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type.startsWith('tag:')) {
    void loadFilters();
  }
});

window.addEventListener('beforeunload', () => {
  document.removeEventListener('keydown', keydownHandler);
  removeEventListener();
  healthCleanup?.();
  syncCleanup?.();
});

// Test helpers for E2E tests (type declaration in library.ts)
(window as unknown as { __testHelpers?: Record<string, unknown> }).__testHelpers = {
  async getSearchHistory() {
    const history = await db.searchHistory.orderBy('createdAt').reverse().toArray();
    return history.map(h => ({
      id: h.id,
      query: h.query,
      resultCount: h.resultCount,
      createdAt: h.createdAt
    }));
  },
  async clearSearchHistory() {
    await db.searchHistory.clear();
  },
  getAutocompleteState() {
    const isVisible = autocompleteDropdown.classList.contains('active');
    const itemCount = autocompleteDropdown.querySelectorAll('.autocomplete-item').length;
    return { isVisible, itemCount };
  }
};
