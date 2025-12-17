import { db, type BookmarkTag, type QuestionAnswer } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initWeb } from '../web/init-web';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';
import { loadTagFilters } from '../lib/tag-filter';
import { config } from '../lib/config-registry';
import { addEventListener as addBookmarkEventListener } from '../lib/events';

const selectedTags = new Set<string>();

const tagFilters = document.getElementById('tagFilters');
if (!tagFilters) {
  throw new Error('Required DOM element tagFilters not found');
}
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const autocompleteDropdown = document.getElementById('autocompleteDropdown');
const resultsList = document.getElementById('resultsList');
const resultStatus = document.getElementById('resultStatus');
const searchPage = document.getElementById('searchPage');
const searchHero = document.getElementById('searchHero');
const resultHeader = document.getElementById('resultHeader');
if (!autocompleteDropdown || !resultsList || !resultStatus || !searchPage || !searchHero || !resultHeader) {
  throw new Error('Required DOM elements not found');
}

searchPage.classList.add('search-page--centered');

const detailPanel2 = document.getElementById('detailPanel');
const detailBackdrop2 = document.getElementById('detailBackdrop');
const detailContent2 = document.getElementById('detailContent');
if (!detailPanel2 || !detailBackdrop2 || !detailContent2) {
  throw new Error('Required DOM elements for detail panel not found');
}

const detailManager = new BookmarkDetailManager({
  detailPanel: detailPanel2,
  detailBackdrop: detailBackdrop2,
  detailContent: detailContent2,
  closeBtn: document.getElementById('closeDetailBtn') as HTMLButtonElement,
  deleteBtn: document.getElementById('deleteBtn') as HTMLButtonElement,
  exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
  debugBtn: document.getElementById('debugBtn') as HTMLButtonElement,
  onDelete: () => void performSearch(),
  onTagsChange: () => void loadFilters()
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

  autocompleteDropdown!.innerHTML = '';

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

    autocompleteDropdown!.appendChild(item);
  }

  autocompleteDropdown!.classList.add('active');
}

function hideAutocomplete(): void {
  autocompleteDropdown!.classList.remove('active');
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
    container: tagFilters!,
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
  searchPage!.classList.remove('search-page--centered');
  searchHero!.classList.add('hidden');
  resultHeader!.classList.remove('hidden');
  resultStatus!.innerHTML = '<span class="spinner"></span> Searching...';
  resultStatus!.classList.add('loading');
}

function showCenteredMode(): void {
  searchPage!.classList.add('search-page--centered');
  searchHero!.classList.remove('hidden');
  resultHeader!.classList.add('hidden');
}

// eslint-disable-next-line complexity
async function performSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) {
    showCenteredMode();
    resultsList!.innerHTML = '';
    return;
  }

  showResultsMode();
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';

  try {
    const [queryEmbedding] = await generateEmbeddings([query]);
    if (queryEmbedding.length === 0) throw new Error('Failed to generate embedding');

    const allQAs = await db.questionsAnswers.toArray();
    const items = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' }
    ]).filter(({ embedding }) => Array.isArray(embedding) && embedding.length === queryEmbedding.length);

    if (!items.length) {
      resultStatus!.classList.remove('loading');
      resultStatus!.textContent = 'No bookmarks indexed yet';
      resultsList!.innerHTML = '';
      resultsList!.appendChild(createElement('div', { className: 'empty-state', textContent: 'Save some bookmarks first to enable search' }));
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

    const sortedResults = Array.from(bookmarkMap.entries())
      .sort((a, b) => Math.max(...b[1].map(r => r.score)) - Math.max(...a[1].map(r => r.score)));

    // Batch load bookmarks and tags to avoid N+1 query pattern
    const bookmarkIds = sortedResults.map(([bookmarkId]) => bookmarkId);
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
    for (const [bookmarkId, qaResults] of sortedResults) {
      const bookmark = bookmarksById.get(bookmarkId);
      if (!bookmark) continue;

      if (selectedTags.size > 0) {
        const tags = tagsByBookmarkId.get(bookmarkId) ?? [];
        if (!tags.some((t: BookmarkTag) => selectedTags.has(t.tagName))) continue;
      }

      filteredResults.push({ bookmark, qaResults });
    }

    const count = filteredResults.length;
    resultStatus!.classList.remove('loading');
    resultStatus!.textContent = count === 0
      ? 'No results found'
      : `${count} result${count === 1 ? '' : 's'}`;
    resultsList!.innerHTML = '';

    if (!filteredResults.length) {
      resultsList!.appendChild(createElement('div', { className: 'empty-state', textContent: 'Try a different search term or check your filters' }));
      await saveSearchHistory(query, 0);
      return;
    }

    await saveSearchHistory(query, filteredResults.length);

    for (const { bookmark, qaResults } of filteredResults) {
      const maxScore = Math.max(...qaResults.map(r => r.score));
      const bestQA = qaResults[0].qa;

      const card = buildResultCard(bookmark, maxScore, bestQA, () => detailManager.showDetail(bookmark.id));
      resultsList!.appendChild(card);
    }
  } catch (error) {
    console.error('Search error:', error);
    resultStatus!.classList.remove('loading');
    resultStatus!.textContent = 'Search failed';
    resultsList!.innerHTML = '';

    const errorMessage = error instanceof Error ? error.message : String(error);
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

    resultsList!.appendChild(errorDiv);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Search';
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

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}

const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type === 'TAG_UPDATED') {
    void loadFilters();
  }
});

window.addEventListener('beforeunload', () => {
  removeEventListener();
});
