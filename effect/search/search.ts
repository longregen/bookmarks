import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { db, type BookmarkTag, type QuestionAnswer } from '../../src/db/schema';
import { createElement, getElement, setSpinnerContent } from '../../src/ui/dom';
import { formatDateByAge } from '../../src/lib/date-format';
import { findTopK } from '../lib/similarity';
import { onThemeChange, applyTheme } from '../../src/shared/theme';
import { initExtension } from '../../src/ui/init-extension';
import { initWeb } from '../../src/web/init-web';
import { createHealthIndicator } from '../../src/ui/health-indicator';
import { BookmarkDetailManager } from '../../src/ui/bookmark-detail';
import { loadTagFilters } from '../../src/ui/tag-filter';
import { config as appConfig } from '../../src/lib/config-registry';
import { addEventListener as addBookmarkEventListener } from '../../src/lib/events';
import { getErrorMessage } from '../lib/errors';
import { SearchError } from '../lib/errors';
import { ApiService } from '../lib/api';
import { LoggingService } from '../services/logging-service';
import { ConfigService } from '../services/config-service';

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  readonly bookmark: {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly createdAt: Date;
  };
  readonly qaResults: readonly {
    readonly qa: QuestionAnswer;
    readonly score: number;
  }[];
  readonly maxScore: number;
}

export interface AutocompleteItem {
  readonly query: string;
  readonly resultCount: number;
}

export interface SearchHistoryEntry {
  readonly id: string;
  readonly query: string;
  readonly resultCount: number;
  readonly createdAt: Date;
}

export interface SearchSettings {
  readonly autocompleteEnabled: boolean;
  readonly historyLimit: number;
  readonly autocompleteLimit: number;
  readonly topKResults: number;
}

// ============================================================================
// Services
// ============================================================================

/**
 * Service for accessing database storage in the search context
 */
export class StorageService extends Context.Tag('StorageService')<
  StorageService,
  {
    /**
     * Get a setting value by key
     */
    readonly getSetting: <T>(key: string) => Effect.Effect<T | null, SearchError>;

    /**
     * Get all question-answer pairs
     */
    readonly getAllQAPairs: () => Effect.Effect<QuestionAnswer[], SearchError>;

    /**
     * Bulk get bookmarks by IDs
     */
    readonly bulkGetBookmarks: (
      ids: readonly string[]
    ) => Effect.Effect<
      Map<string, { id: string; title: string; url: string; createdAt: Date }>,
      SearchError
    >;

    /**
     * Get bookmark tags for multiple bookmarks
     */
    readonly getBookmarkTags: (
      bookmarkIds: readonly string[]
    ) => Effect.Effect<Map<string, BookmarkTag[]>, SearchError>;

    /**
     * Get recent search history matching a query prefix
     */
    readonly getSearchHistory: (
      query: string,
      limit: number
    ) => Effect.Effect<AutocompleteItem[], SearchError>;

    /**
     * Save a search query to history
     */
    readonly saveSearchHistory: (
      query: string,
      resultCount: number
    ) => Effect.Effect<void, SearchError>;
  }
>() {}

/**
 * Service for semantic search operations
 */
export class SearchService extends Context.Tag('SearchService')<
  SearchService,
  {
    /**
     * Perform semantic search across all bookmarks
     */
    readonly search: (
      query: string,
      selectedTags: ReadonlySet<string>
    ) => Effect.Effect<SearchResult[], SearchError>;

    /**
     * Get autocomplete suggestions for a query
     */
    readonly getAutocompleteSuggestions: (
      query: string
    ) => Effect.Effect<AutocompleteItem[], SearchError>;

    /**
     * Get search settings
     */
    readonly getSettings: () => Effect.Effect<SearchSettings, SearchError>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

/**
 * Live implementation of StorageService using Dexie
 */
export const StorageServiceLive = Layer.succeed(StorageService, {
  getSetting: <T>(key: string) =>
    Effect.tryPromise({
      try: async () => {
        const setting = await db.settings.get(key);
        return setting ? (setting.value as T) : null;
      },
      catch: (error) =>
        new SearchError({
          code: 'INDEX_UNAVAILABLE',
          query: '',
          message: `Failed to get setting: ${getErrorMessage(error)}`,
          originalError: error,
        }),
    }),

  getAllQAPairs: () =>
    Effect.tryPromise({
      try: () => db.questionsAnswers.toArray(),
      catch: (error) =>
        new SearchError({
          code: 'INDEX_UNAVAILABLE',
          query: '',
          message: `Failed to load Q&A pairs: ${getErrorMessage(error)}`,
          originalError: error,
        }),
    }),

  bulkGetBookmarks: (ids: readonly string[]) =>
    Effect.tryPromise({
      try: async () => {
        const bookmarks = await db.bookmarks.bulkGet([...ids]);
        const bookmarksMap = new Map<
          string,
          { id: string; title: string; url: string; createdAt: Date }
        >();

        for (const bookmark of bookmarks) {
          if (bookmark) {
            bookmarksMap.set(bookmark.id, {
              id: bookmark.id,
              title: bookmark.title,
              url: bookmark.url,
              createdAt: bookmark.createdAt,
            });
          }
        }

        return bookmarksMap;
      },
      catch: (error) =>
        new SearchError({
          code: 'INDEX_UNAVAILABLE',
          query: '',
          message: `Failed to load bookmarks: ${getErrorMessage(error)}`,
          originalError: error,
        }),
    }),

  getBookmarkTags: (bookmarkIds: readonly string[]) =>
    Effect.tryPromise({
      try: async () => {
        const allTags = await db.bookmarkTags
          .where('bookmarkId')
          .anyOf([...bookmarkIds])
          .toArray();

        const tagsByBookmarkId = new Map<string, BookmarkTag[]>();
        for (const tag of allTags) {
          const existing = tagsByBookmarkId.get(tag.bookmarkId);
          if (existing) {
            existing.push(tag);
          } else {
            tagsByBookmarkId.set(tag.bookmarkId, [tag]);
          }
        }

        return tagsByBookmarkId;
      },
      catch: (error) =>
        new SearchError({
          code: 'INDEX_UNAVAILABLE',
          query: '',
          message: `Failed to load bookmark tags: ${getErrorMessage(error)}`,
          originalError: error,
        }),
    }),

  getSearchHistory: (query: string, limit: number) =>
    Effect.tryPromise({
      try: async () => {
        const lowerQuery = query.trim().toLowerCase();
        const allHistory = await db.searchHistory
          .orderBy('createdAt')
          .reverse()
          .toArray();

        const matchingHistory = allHistory
          .filter(
            (h) =>
              h.query.toLowerCase().includes(lowerQuery) &&
              h.query.toLowerCase() !== lowerQuery
          )
          .slice(0, limit)
          .map((h) => ({
            query: h.query,
            resultCount: h.resultCount,
          }));

        return matchingHistory;
      },
      catch: (error) =>
        new SearchError({
          code: 'INDEX_UNAVAILABLE',
          query: '',
          message: `Failed to load search history: ${getErrorMessage(error)}`,
          originalError: error,
        }),
    }),

  saveSearchHistory: (query: string, resultCount: number) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          const id = crypto.randomUUID();
          const createdAt = new Date();

          await db.searchHistory.add({
            id,
            query,
            resultCount,
            createdAt,
          });

          const allHistory = await db.searchHistory.orderBy('createdAt').toArray();
          if (allHistory.length > appConfig.SEARCH_HISTORY_LIMIT) {
            const toDelete = allHistory.slice(
              0,
              allHistory.length - appConfig.SEARCH_HISTORY_LIMIT
            );
            await Promise.all(toDelete.map((h) => db.searchHistory.delete(h.id)));
          }
        },
        catch: (error) =>
          new SearchError({
            code: 'UNKNOWN',
            query: '',
            message: `Failed to save search history: ${getErrorMessage(error)}`,
            originalError: error,
          }),
      });
    }),
});

/**
 * Live implementation of SearchService
 */
export const SearchServiceLive = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const storage = yield* StorageService;
    const api = yield* ApiService;
    const logging = yield* LoggingService;
    const configService = yield* ConfigService;

    return {
      search: (query: string, selectedTags: ReadonlySet<string>) =>
        Effect.gen(function* () {
          yield* logging.debug('Starting semantic search', { query });

          // Generate embedding for query
          const queryEmbeddings = yield* api.generateEmbeddings([query]).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new SearchError({
                  code: 'EMBEDDING_FAILED',
                  query,
                  message: `Failed to generate query embedding: ${getErrorMessage(error)}`,
                  originalError: error,
                })
              )
            )
          );

          const queryEmbedding = queryEmbeddings[0];
          if (!queryEmbedding || queryEmbedding.length === 0) {
            return yield* Effect.fail(
              new SearchError({
                code: 'EMBEDDING_FAILED',
                query,
                message: 'Failed to generate embedding',
              })
            );
          }

          // Get all Q&A pairs
          const allQAs = yield* storage.getAllQAPairs();

          // Prepare items for similarity search
          const items = allQAs.flatMap((qa) => [
            { item: qa, embedding: [...qa.embeddingQuestion], type: 'question' },
            { item: qa, embedding: [...qa.embeddingBoth], type: 'both' },
          ]);

          // Filter valid embeddings
          const validItems = items.filter(
            ({ embedding }) =>
              Array.isArray(embedding) && embedding.length === queryEmbedding.length
          );

          if (validItems.length === 0) {
            yield* logging.debug('No indexed bookmarks found');
            return [];
          }

          // Get top K config value
          const topK = yield* configService
            .get<number>('SEARCH_TOP_K_RESULTS')
            .pipe(Effect.orElseSucceed(() => 100));

          // Find top K results
          const topResults = yield* findTopK(queryEmbedding, validItems, topK);

          // Group results by bookmark
          const bookmarkMap = new Map<
            string,
            { qa: QuestionAnswer; score: number }[]
          >();

          for (const result of topResults) {
            const bookmarkId = result.item.bookmarkId;
            const existing = bookmarkMap.get(bookmarkId);
            if (existing) {
              existing.push({ qa: result.item, score: result.score });
            } else {
              bookmarkMap.set(bookmarkId, [{ qa: result.item, score: result.score }]);
            }
          }

          // Calculate max scores and sort
          const resultsWithMax = Array.from(bookmarkMap.entries())
            .map(([id, results]) => ({
              bookmarkId: id,
              qaResults: results,
              maxScore: Math.max(...results.map((r) => r.score)),
            }))
            .sort((a, b) => b.maxScore - a.maxScore);

          // Load bookmark data
          const bookmarkIds = resultsWithMax.map((r) => r.bookmarkId);
          const bookmarksById = yield* storage.bulkGetBookmarks(bookmarkIds);

          // Load tags if filtering is needed
          let tagsByBookmarkId: Map<string, BookmarkTag[]> | null = null;
          if (selectedTags.size > 0) {
            tagsByBookmarkId = yield* storage.getBookmarkTags(bookmarkIds);
          }

          // Filter by tags and build final results
          const filteredResults: SearchResult[] = [];
          for (const result of resultsWithMax) {
            const bookmark = bookmarksById.get(result.bookmarkId);
            if (!bookmark) continue;

            // Apply tag filter if needed
            if (selectedTags.size > 0 && tagsByBookmarkId) {
              const tags = tagsByBookmarkId.get(result.bookmarkId) ?? [];
              if (!tags.some((t) => selectedTags.has(t.tagName))) continue;
            }

            filteredResults.push({
              bookmark,
              qaResults: result.qaResults,
              maxScore: result.maxScore,
            });
          }

          yield* logging.debug('Search complete', {
            resultCount: filteredResults.length,
          });

          return filteredResults;
        }),

      getAutocompleteSuggestions: (query: string) =>
        Effect.gen(function* () {
          const autocompleteLimit = yield* configService
            .get<number>('SEARCH_AUTOCOMPLETE_LIMIT')
            .pipe(Effect.orElseSucceed(() => 5));

          return yield* storage.getSearchHistory(query, autocompleteLimit);
        }),

      getSettings: () =>
        Effect.gen(function* () {
          const autocompleteEnabled = yield* storage
            .getSetting<boolean>('searchAutocomplete')
            .pipe(Effect.map((value) => value ?? true));

          const historyLimit = yield* configService
            .get<number>('SEARCH_HISTORY_LIMIT')
            .pipe(Effect.orElseSucceed(() => 100));

          const autocompleteLimit = yield* configService
            .get<number>('SEARCH_AUTOCOMPLETE_LIMIT')
            .pipe(Effect.orElseSucceed(() => 5));

          const topKResults = yield* configService
            .get<number>('SEARCH_TOP_K_RESULTS')
            .pipe(Effect.orElseSucceed(() => 100));

          return {
            autocompleteEnabled,
            historyLimit,
            autocompleteLimit,
            topKResults,
          };
        }),
    };
  })
).pipe(Layer.provide(StorageServiceLive));

// ============================================================================
// Main Layer
// ============================================================================

/**
 * Complete search layer with all dependencies
 */
export const SearchLayerLive = Layer.mergeAll(
  StorageServiceLive,
  SearchServiceLive
);

// ============================================================================
// UI Integration Layer
// ============================================================================

/**
 * Search UI state and operations
 *
 * This class bridges the Effect-based services with the existing DOM-based UI.
 * It maintains backward compatibility while gradually introducing Effect patterns.
 */
export class SearchUI {
  private selectedTags = new Set<string>();
  private searchService: typeof SearchService.Service;
  private storageService: typeof StorageService.Service;

  constructor(
    private readonly elements: {
      tagFilters: HTMLElement;
      searchInput: HTMLInputElement;
      searchBtn: HTMLButtonElement;
      autocompleteDropdown: HTMLElement;
      resultsList: HTMLElement;
      resultStatus: HTMLElement;
      searchPage: HTMLElement;
      searchHero: HTMLElement;
      resultHeader: HTMLElement;
    },
    private readonly detailManager: BookmarkDetailManager,
    searchService: typeof SearchService.Service,
    storageService: typeof StorageService.Service
  ) {
    this.searchService = searchService;
    this.storageService = storageService;
    this.initializeEventListeners();
  }

  private initializeEventListeners(): void {
    const { searchBtn, searchInput, autocompleteDropdown } = this.elements;

    searchBtn.addEventListener('click', () => void this.performSearch());
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') void this.performSearch();
    });
    searchInput.addEventListener('input', () => void this.showAutocomplete());
    searchInput.addEventListener('focus', () => void this.showAutocomplete());
    searchInput.addEventListener('blur', () =>
      setTimeout(() => this.hideAutocomplete(), 200)
    );
  }

  async loadFilters(): Promise<void> {
    await loadTagFilters({
      container: this.elements.tagFilters,
      selectedTags: this.selectedTags,
      onChange: () => {
        void this.loadFilters();
        if (this.elements.searchInput.value.trim()) {
          void this.performSearch();
        }
      },
    });
  }

  async showAutocomplete(): Promise<void> {
    const query = this.elements.searchInput.value.trim();

    if (!query) {
      this.hideAutocomplete();
      return;
    }

    const effect = this.searchService.getAutocompleteSuggestions(query);

    const result = await Effect.runPromise(
      effect.pipe(
        Effect.catchAll((error) => {
          console.error('Autocomplete error:', error);
          return Effect.succeed([]);
        })
      )
    );

    if (result.length === 0) {
      this.hideAutocomplete();
      return;
    }

    this.renderAutocomplete(result);
  }

  private renderAutocomplete(items: AutocompleteItem[]): void {
    const { autocompleteDropdown, searchInput } = this.elements;

    autocompleteDropdown.innerHTML = '';

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const itemDiv = createElement('div', { className: 'autocomplete-item' });

      const querySpan = createElement('span', {
        className: 'autocomplete-query',
        textContent: item.query,
      });

      const countSpan = createElement('span', {
        className: 'autocomplete-count',
        textContent: `${item.resultCount} result${item.resultCount !== 1 ? 's' : ''}`,
      });

      itemDiv.appendChild(querySpan);
      itemDiv.appendChild(countSpan);

      itemDiv.onclick = () => {
        searchInput.value = item.query;
        this.hideAutocomplete();
        void this.performSearch();
      };

      fragment.appendChild(itemDiv);
    }
    autocompleteDropdown.appendChild(fragment);

    autocompleteDropdown.classList.add('active');
  }

  private hideAutocomplete(): void {
    this.elements.autocompleteDropdown.classList.remove('active');
  }

  private showResultsMode(): void {
    const { searchPage, searchHero, resultHeader, resultStatus } = this.elements;
    searchPage.classList.remove('search-page--centered');
    searchHero.classList.add('hidden');
    resultHeader.classList.remove('hidden');
    setSpinnerContent(resultStatus, 'Searching...');
    resultStatus.classList.add('loading');
  }

  private showCenteredMode(): void {
    const { searchPage, searchHero, resultHeader } = this.elements;
    searchPage.classList.add('search-page--centered');
    searchHero.classList.remove('hidden');
    resultHeader.classList.add('hidden');
  }

  async performSearch(): Promise<void> {
    const query = this.elements.searchInput.value.trim();

    if (!query) {
      this.showCenteredMode();
      this.elements.resultsList.innerHTML = '';
      return;
    }

    this.showResultsMode();
    this.elements.searchBtn.disabled = true;

    const searchEffect = Effect.gen(() => this.searchService.search(query, this.selectedTags));

    const result = await Effect.runPromise(
      searchEffect.pipe(
        Effect.tap((results) =>
          this.storageService.saveSearchHistory(query, results.length)
        ),
        Effect.either
      )
    );

    this.elements.searchBtn.disabled = false;

    if (result._tag === 'Left') {
      this.renderError(result.left);
      return;
    }

    const results = result.right;
    this.renderResults(results);
  }

  private renderResults(results: SearchResult[]): void {
    const { resultStatus, resultsList } = this.elements;

    resultStatus.classList.remove('loading');
    const count = results.length;
    resultStatus.textContent =
      count === 0 ? 'No results found' : `${count} result${count === 1 ? '' : 's'}`;

    resultsList.innerHTML = '';

    if (results.length === 0) {
      resultsList.appendChild(
        createElement('div', {
          className: 'empty-state',
          textContent: 'Try a different search term or check your filters',
        })
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const bestQA = result.qaResults[0].qa;
      const card = this.buildResultCard(result.bookmark, result.maxScore, bestQA);
      fragment.appendChild(card);
    }
    resultsList.appendChild(fragment);
  }

  private buildResultCard(
    bookmark: { id: string; title: string; url: string; createdAt: Date },
    maxScore: number,
    bestQA: { question: string; answer: string }
  ): HTMLElement {
    const card = createElement('div', { className: 'result-card' });
    card.onclick = () => this.detailManager.showDetail(bookmark.id);

    card.appendChild(
      createElement('div', {
        className: 'relevance',
        textContent: `${(maxScore * 100).toFixed(0)}% match`,
      })
    );

    card.appendChild(
      createElement('div', { className: 'card-title', textContent: bookmark.title })
    );

    const meta = createElement('div', { className: 'card-meta' });
    const url = createElement('a', {
      className: 'card-url',
      href: bookmark.url,
      textContent: new URL(bookmark.url).hostname,
    });
    url.onclick = (e) => e.stopPropagation();
    meta.appendChild(url);
    meta.appendChild(
      document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)}`)
    );
    card.appendChild(meta);

    const qaPreview = createElement('div', { className: 'qa-preview' });
    qaPreview.appendChild(
      createElement('div', {
        className: 'qa-q',
        textContent: `Q: ${bestQA.question}`,
      })
    );
    qaPreview.appendChild(
      createElement('div', {
        className: 'qa-a',
        textContent: `A: ${bestQA.answer}`,
      })
    );
    card.appendChild(qaPreview);

    return card;
  }

  private renderError(error: SearchError): void {
    const { resultStatus, resultsList } = this.elements;

    console.error('Search error:', error);
    resultStatus.classList.remove('loading');
    resultStatus.textContent = 'Search failed';
    resultsList.innerHTML = '';

    const errorMessage = error.message;
    const isApiKeyError =
      errorMessage.toLowerCase().includes('api key') ||
      errorMessage.toLowerCase().includes('not configured') ||
      errorMessage.toLowerCase().includes('401') ||
      errorMessage.toLowerCase().includes('unauthorized');

    const errorDiv = createElement('div', { className: 'error-message' });

    if (isApiKeyError) {
      errorDiv.appendChild(
        document.createTextNode('API endpoint not configured. ')
      );
      const settingsLink = createElement('a', {
        href: '../options/options.html',
        textContent: 'Configure in Settings',
        className: 'error-link',
      });
      errorDiv.appendChild(settingsLink);
    } else {
      errorDiv.appendChild(document.createTextNode(`${errorMessage} `));
      const settingsLink = createElement('a', {
        href: '../options/options.html',
        textContent: 'Check Settings',
        className: 'error-link',
      });
      errorDiv.appendChild(settingsLink);
    }

    resultsList.appendChild(errorDiv);
  }
}

// ============================================================================
// Runtime Initialization (Backward Compatibility)
// ============================================================================

/**
 * Initialize the search UI with Effect services
 *
 * This function maintains backward compatibility with the existing
 * initialization code while integrating Effect services.
 */
export function initializeSearchUI(): void {
  // Get DOM elements
  const elements = {
    tagFilters: getElement('tagFilters'),
    searchInput: getElement<HTMLInputElement>('searchInput'),
    searchBtn: getElement<HTMLButtonElement>('searchBtn'),
    autocompleteDropdown: getElement('autocompleteDropdown'),
    resultsList: getElement('resultsList'),
    resultStatus: getElement('resultStatus'),
    searchPage: getElement('searchPage'),
    searchHero: getElement('searchHero'),
    resultHeader: getElement('resultHeader'),
  };

  elements.searchPage.classList.add('search-page--centered');

  const detailPanel = getElement('detailPanel');
  const detailBackdrop = getElement('detailBackdrop');
  const detailContent = getElement('detailContent');

  // Initialize detail manager
  const detailManager = new BookmarkDetailManager({
    detailPanel,
    detailBackdrop,
    detailContent,
    closeBtn: getElement<HTMLButtonElement>('closeDetailBtn'),
    deleteBtn: getElement<HTMLButtonElement>('deleteBtn'),
    exportBtn: getElement<HTMLButtonElement>('exportBtn'),
    debugBtn: getElement<HTMLButtonElement>('debugBtn'),
    retryBtn: getElement<HTMLButtonElement>('retryBtn'),
    onDelete: () => void searchUI.performSearch(),
    onTagsChange: () => void searchUI.loadFilters(),
    onRetry: () => void searchUI.performSearch(),
  });

  // Create a minimal runtime for search services
  // Note: In a full implementation, you'd use Effect.runSync with proper layers
  // For now, we'll create service instances directly
  const searchService = {
    search: (query: string, selectedTags: ReadonlySet<string>) =>
      Effect.provide(
        SearchService.pipe(Effect.flatMap((s) => s.search(query, selectedTags))),
        SearchServiceLive
      ),
    getAutocompleteSuggestions: (query: string) =>
      Effect.provide(
        SearchService.pipe(Effect.flatMap((s) => s.getAutocompleteSuggestions(query))),
        SearchServiceLive
      ),
    getSettings: () =>
      Effect.provide(
        SearchService.pipe(Effect.flatMap((s) => s.getSettings())),
        SearchServiceLive
      ),
  };

  const storageService = {
    saveSearchHistory: (query: string, resultCount: number) =>
      Effect.provide(
        StorageService.pipe(
          Effect.flatMap((s) => s.saveSearchHistory(query, resultCount))
        ),
        StorageServiceLive
      ),
  };

  // Initialize search UI
  const searchUI = new SearchUI(elements, detailManager, searchService, storageService);

  // Initialize platform-specific code
  if (__IS_WEB__) {
    void initWeb();
  } else {
    void initExtension();
  }

  // Theme handling
  onThemeChange((theme) => applyTheme(theme));

  // Load filters
  void searchUI.loadFilters();

  // Handle initial query from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const initialQuery = urlParams.get('q');
  if (initialQuery !== null && initialQuery !== '') {
    elements.searchInput.value = initialQuery;
    void searchUI.performSearch();
  }

  // Focus search input
  elements.searchInput.focus();

  // Keyboard shortcut
  const keydownHandler = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      elements.searchInput.focus();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Health indicator
  const healthIndicatorContainer = document.getElementById('healthIndicator');
  if (healthIndicatorContainer) {
    createHealthIndicator(healthIndicatorContainer);
  }

  // Event listeners
  const removeEventListener = addBookmarkEventListener((event) => {
    if (event.type.startsWith('tag:')) {
      void searchUI.loadFilters();
    }
  });

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    document.removeEventListener('keydown', keydownHandler);
    removeEventListener();
  });
}
