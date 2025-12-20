import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  SearchService,
  StorageService,
  SearchUI,
  type SearchResult,
  type AutocompleteItem,
} from '../effect/search/search';
import { ApiService } from '../effect/lib/api';
import { LoggingService } from '../effect/services/logging-service';
import { ConfigService } from '../effect/services/config-service';
import { SearchError } from '../effect/lib/errors';
import type { QuestionAnswer, BookmarkTag } from '../src/db/schema';

// ============================================================================
// Test Setup and Utilities
// ============================================================================

const createMockElements = () => {
  const createInput = () => {
    const input = document.createElement('input');
    input.id = 'searchInput';
    return input;
  };

  const createButton = () => {
    const button = document.createElement('button');
    button.id = 'searchBtn';
    return button;
  };

  const createDiv = (id: string) => {
    const div = document.createElement('div');
    div.id = id;
    return div;
  };

  return {
    tagFilters: createDiv('tagFilters'),
    searchInput: createInput(),
    searchBtn: createButton(),
    autocompleteDropdown: createDiv('autocompleteDropdown'),
    resultsList: createDiv('resultsList'),
    resultStatus: createDiv('resultStatus'),
    searchPage: createDiv('searchPage'),
    searchHero: createDiv('searchHero'),
    resultHeader: createDiv('resultHeader'),
  };
};

const createMockDetailManager = () => ({
  showDetail: vi.fn(),
  hideDetail: vi.fn(),
});

// ============================================================================
// Mock Services
// ============================================================================

const MockLoggingService = Layer.succeed(LoggingService, {
  debug: () => Effect.void,
  info: () => Effect.void,
  warn: () => Effect.void,
  error: () => Effect.void,
});

const MockConfigService = Layer.succeed(ConfigService, {
  get: <T>(key: string) => {
    const defaults: Record<string, unknown> = {
      SEARCH_TOP_K_RESULTS: 100,
      SIMILARITY_THRESHOLD_EXCELLENT: 0.9,
      SIMILARITY_THRESHOLD_GOOD: 0.75,
      SIMILARITY_THRESHOLD_FAIR: 0.6,
      SIMILARITY_THRESHOLD_POOR: 0.4,
      SEARCH_AUTOCOMPLETE_LIMIT: 5,
      SEARCH_HISTORY_LIMIT: 100,
    };
    return Effect.succeed(defaults[key] as T);
  },
});

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockQAPairs = (count: number): QuestionAnswer[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `qa-${i}`,
    bookmarkId: `bookmark-${i % 3}`,
    question: `Question ${i}`,
    answer: `Answer ${i}`,
    embeddingQuestion: [i / count, 0.5, 0.3],
    embeddingBoth: [(i + 0.5) / count, 0.6, 0.4],
    createdAt: new Date(),
  }));
};

const createMockBookmarks = (ids: string[]) => {
  const bookmarks = new Map();
  ids.forEach((id, index) => {
    bookmarks.set(id, {
      id,
      title: `Bookmark ${index}`,
      url: `https://example.com/${index}`,
      createdAt: new Date(),
    });
  });
  return bookmarks;
};

const createMockBookmarkTags = (bookmarkIds: string[]): Map<string, BookmarkTag[]> => {
  const tagMap = new Map<string, BookmarkTag[]>();
  bookmarkIds.forEach((id, index) => {
    if (index % 2 === 0) {
      tagMap.set(id, [
        {
          bookmarkId: id,
          tagName: 'tech',
          createdAt: new Date(),
        },
      ]);
    } else {
      tagMap.set(id, [
        {
          bookmarkId: id,
          tagName: 'science',
          createdAt: new Date(),
        },
      ]);
    }
  });
  return tagMap;
};

// ============================================================================
// Test Suite: Search UI Lifecycle Integration
// ============================================================================

describe('Search UI Lifecycle Integration', () => {
  let elements: ReturnType<typeof createMockElements>;
  let detailManager: ReturnType<typeof createMockDetailManager>;
  let searchUI: SearchUI;
  let mockQAPairs: QuestionAnswer[];
  let mockSearchHistory: AutocompleteItem[];

  beforeEach(() => {
    // Setup DOM elements
    elements = createMockElements();
    detailManager = createMockDetailManager();

    // Setup test data
    mockQAPairs = createMockQAPairs(9);
    mockSearchHistory = [
      { query: 'previous search 1', resultCount: 5 },
      { query: 'previous search 2', resultCount: 3 },
      { query: 'previous test query', resultCount: 10 },
    ];

    // Append elements to document for event testing
    Object.values(elements).forEach((el) => {
      if (el instanceof HTMLElement) {
        document.body.appendChild(el);
      }
    });
  });

  afterEach(() => {
    // Cleanup DOM
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // ============================================================================
  // Test: SearchService Initialization
  // ============================================================================

  describe('SearchService Initialization', () => {
    it('should initialize SearchService with all dependencies', async () => {
      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(true),
        getAllQAPairs: () => Effect.succeed(mockQAPairs),
        bulkGetBookmarks: () => Effect.succeed(createMockBookmarks(['bookmark-0'])),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: () => Effect.succeed([[0.5, 0.5, 0.3]]),
      });

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        MockConfigService,
        mockStorageService,
        mockApiService
      );

      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        const api = yield* ApiService;
        const logging = yield* LoggingService;
        const config = yield* ConfigService;

        return {
          storage,
          api,
          logging,
          config,
        };
      });

      const services = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(services.storage).toBeDefined();
      expect(services.api).toBeDefined();
      expect(services.logging).toBeDefined();
      expect(services.config).toBeDefined();
    });

    it('should load search settings from ConfigService', async () => {
      const customConfig = Layer.succeed(ConfigService, {
        get: <T>(key: string) => {
          const config: Record<string, unknown> = {
            SEARCH_TOP_K_RESULTS: 50,
            SEARCH_AUTOCOMPLETE_LIMIT: 10,
            SEARCH_HISTORY_LIMIT: 200,
          };
          return Effect.succeed(config[key] as T);
        },
      });

      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: (key: string) => {
          if (key === 'searchAutocomplete') {
            return Effect.succeed(false as any);
          }
          return Effect.succeed(null);
        },
        getAllQAPairs: () => Effect.succeed([]),
        bulkGetBookmarks: () => Effect.succeed(new Map()),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        customConfig,
        mockStorageService
      );

      const program = Effect.gen(function* () {
        const config = yield* ConfigService;
        const storage = yield* StorageService;

        const topK = yield* config.get<number>('SEARCH_TOP_K_RESULTS');
        const autocompleteLimit = yield* config.get<number>('SEARCH_AUTOCOMPLETE_LIMIT');
        const historyLimit = yield* config.get<number>('SEARCH_HISTORY_LIMIT');
        const autocompleteEnabled = yield* storage.getSetting<boolean>('searchAutocomplete');

        return {
          topK,
          autocompleteLimit,
          historyLimit,
          autocompleteEnabled,
        };
      });

      const settings = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(settings.topK).toBe(50);
      expect(settings.autocompleteLimit).toBe(10);
      expect(settings.historyLimit).toBe(200);
      expect(settings.autocompleteEnabled).toBe(false);
    });
  });

  // ============================================================================
  // Test: Search Execution Flow
  // ============================================================================

  describe('Search Execution Flow', () => {
    it('should execute full search flow from query to results', async () => {
      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed(mockQAPairs),
        bulkGetBookmarks: () =>
          Effect.succeed(createMockBookmarks(['bookmark-0', 'bookmark-1', 'bookmark-2'])),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: (query, count) => {
          expect(query).toBe('test query');
          expect(count).toBeGreaterThanOrEqual(0);
          return Effect.void;
        },
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: (texts: string[]) => {
          expect(texts).toEqual(['test query']);
          return Effect.succeed([[0.5, 0.5, 0.3]]);
        },
      });

      const searchService = {
        search: (query: string, selectedTags: ReadonlySet<string>) =>
          Effect.provide(
            Effect.gen(function* () {
              const api = yield* ApiService;
              const storage = yield* StorageService;
              const logging = yield* LoggingService;

              yield* logging.debug('Starting search', { query });

              const embeddings = yield* api.generateEmbeddings([query]);
              const qaPairs = yield* storage.getAllQAPairs();
              const bookmarks = yield* storage.bulkGetBookmarks(['bookmark-0']);

              const results: SearchResult[] = [
                {
                  bookmark: Array.from(bookmarks.values())[0],
                  qaResults: [{ qa: qaPairs[0], score: 0.95 }],
                  maxScore: 0.95,
                },
              ];

              return results;
            }),
            Layer.mergeAll(
              MockLoggingService,
              MockConfigService,
              mockStorageService,
              mockApiService
            )
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: (query: string, resultCount: number) =>
          Effect.provide(
            Effect.gen(function* () {
              const storage = yield* StorageService;
              return yield* storage.saveSearchHistory(query, resultCount);
            }),
            Layer.mergeAll(MockLoggingService, mockStorageService)
          ),
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test query';
      await searchUI.performSearch();

      expect(elements.resultStatus.textContent).toContain('result');
      expect(elements.resultsList.children.length).toBeGreaterThan(0);
    });

    it('should handle empty query gracefully', async () => {
      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = '';
      await searchUI.performSearch();

      expect(elements.searchPage.classList.contains('search-page--centered')).toBe(true);
      expect(elements.resultsList.innerHTML).toBe('');
    });

    it('should display loading state during search', async () => {
      let resolveSearch: (results: SearchResult[]) => void;
      const searchPromise = new Promise<SearchResult[]>((resolve) => {
        resolveSearch = resolve;
      });

      const searchService = {
        search: () => Effect.promise(() => searchPromise),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test query';
      const searchExecution = searchUI.performSearch();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(elements.resultStatus.classList.contains('loading')).toBe(true);
      expect(elements.searchBtn.disabled).toBe(true);

      resolveSearch!([]);
      await searchExecution;

      expect(elements.resultStatus.classList.contains('loading')).toBe(false);
      expect(elements.searchBtn.disabled).toBe(false);
    });
  });

  // ============================================================================
  // Test: Result Ranking and Display
  // ============================================================================

  describe('Result Ranking and Display', () => {
    it('should display results ordered by relevance score', async () => {
      const results: SearchResult[] = [
        {
          bookmark: {
            id: 'bookmark-1',
            title: 'High Match',
            url: 'https://example.com/1',
            createdAt: new Date(),
          },
          qaResults: [
            { qa: mockQAPairs[0], score: 0.95 },
            { qa: mockQAPairs[1], score: 0.90 },
          ],
          maxScore: 0.95,
        },
        {
          bookmark: {
            id: 'bookmark-2',
            title: 'Medium Match',
            url: 'https://example.com/2',
            createdAt: new Date(),
          },
          qaResults: [{ qa: mockQAPairs[2], score: 0.75 }],
          maxScore: 0.75,
        },
        {
          bookmark: {
            id: 'bookmark-3',
            title: 'Low Match',
            url: 'https://example.com/3',
            createdAt: new Date(),
          },
          qaResults: [{ qa: mockQAPairs[3], score: 0.60 }],
          maxScore: 0.60,
        },
      ];

      const searchService = {
        search: () => Effect.succeed(results),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test query';
      await searchUI.performSearch();

      const cards = elements.resultsList.querySelectorAll('.result-card');
      expect(cards.length).toBe(3);

      const firstRelevance = cards[0].querySelector('.relevance')?.textContent;
      const secondRelevance = cards[1].querySelector('.relevance')?.textContent;
      const thirdRelevance = cards[2].querySelector('.relevance')?.textContent;

      expect(firstRelevance).toContain('95%');
      expect(secondRelevance).toContain('75%');
      expect(thirdRelevance).toContain('60%');
    });

    it('should render result cards with all required elements', async () => {
      const result: SearchResult = {
        bookmark: {
          id: 'bookmark-1',
          title: 'Test Bookmark',
          url: 'https://example.com/test',
          createdAt: new Date('2024-01-01'),
        },
        qaResults: [
          {
            qa: {
              id: 'qa-1',
              bookmarkId: 'bookmark-1',
              question: 'What is this about?',
              answer: 'This is a test bookmark',
              embeddingQuestion: [0.5, 0.5, 0.3],
              embeddingBoth: [0.6, 0.6, 0.4],
              createdAt: new Date(),
            },
            score: 0.88,
          },
        ],
        maxScore: 0.88,
      };

      const searchService = {
        search: () => Effect.succeed([result]),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      const card = elements.resultsList.querySelector('.result-card');
      expect(card).toBeTruthy();

      expect(card?.querySelector('.relevance')?.textContent).toContain('88%');
      expect(card?.querySelector('.card-title')?.textContent).toBe('Test Bookmark');
      expect(card?.querySelector('.card-url')?.textContent).toBe('example.com');
      expect(card?.querySelector('.qa-preview')).toBeTruthy();
      expect(card?.querySelector('.qa-q')?.textContent).toContain('What is this about?');
      expect(card?.querySelector('.qa-a')?.textContent).toContain('This is a test bookmark');
    });

    it('should handle no results state', async () => {
      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'nonexistent query';
      await searchUI.performSearch();

      expect(elements.resultStatus.textContent).toBe('No results found');
      expect(elements.resultsList.querySelector('.empty-state')).toBeTruthy();
      expect(elements.resultsList.querySelector('.empty-state')?.textContent).toContain(
        'Try a different search term'
      );
    });

    it('should open bookmark detail on card click', async () => {
      const result: SearchResult = {
        bookmark: {
          id: 'bookmark-123',
          title: 'Test Bookmark',
          url: 'https://example.com/test',
          createdAt: new Date(),
        },
        qaResults: [{ qa: mockQAPairs[0], score: 0.88 }],
        maxScore: 0.88,
      };

      const searchService = {
        search: () => Effect.succeed([result]),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      const card = elements.resultsList.querySelector('.result-card') as HTMLElement;
      expect(card).toBeTruthy();

      card.click();

      expect(detailManager.showDetail).toHaveBeenCalledWith('bookmark-123');
    });
  });

  // ============================================================================
  // Test: Autocomplete Suggestions
  // ============================================================================

  describe('Autocomplete Suggestions', () => {
    it('should show autocomplete suggestions on input', async () => {
      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: (query: string) => {
          if (query === 'test') {
            return Effect.succeed(mockSearchHistory);
          }
          return Effect.succeed([]);
        },
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.showAutocomplete();

      expect(elements.autocompleteDropdown.classList.contains('active')).toBe(true);
      expect(elements.autocompleteDropdown.children.length).toBe(3);
    });

    it('should render autocomplete items with query and result count', async () => {
      const suggestions: AutocompleteItem[] = [
        { query: 'javascript tutorials', resultCount: 12 },
        { query: 'javascript frameworks', resultCount: 8 },
      ];

      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: () => Effect.succeed(suggestions),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'javascript';
      await searchUI.showAutocomplete();

      const items = elements.autocompleteDropdown.querySelectorAll('.autocomplete-item');
      expect(items.length).toBe(2);

      const firstQuery = items[0].querySelector('.autocomplete-query')?.textContent;
      const firstCount = items[0].querySelector('.autocomplete-count')?.textContent;

      expect(firstQuery).toBe('javascript tutorials');
      expect(firstCount).toBe('12 results');
    });

    it('should hide autocomplete when input is empty', async () => {
      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.autocompleteDropdown.classList.add('active');

      elements.searchInput.value = '';
      await searchUI.showAutocomplete();

      expect(elements.autocompleteDropdown.classList.contains('active')).toBe(false);
    });

    it('should select autocomplete suggestion on click', async () => {
      const suggestions: AutocompleteItem[] = [
        { query: 'selected query', resultCount: 5 },
      ];

      const searchService = {
        search: vi.fn(() => Effect.succeed([])),
        getAutocompleteSuggestions: () => Effect.succeed(suggestions),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'sel';
      await searchUI.showAutocomplete();

      const item = elements.autocompleteDropdown.querySelector(
        '.autocomplete-item'
      ) as HTMLElement;
      expect(item).toBeTruthy();

      item.click();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(elements.searchInput.value).toBe('selected query');
      expect(elements.autocompleteDropdown.classList.contains('active')).toBe(false);
    });

    it('should handle autocomplete errors gracefully', async () => {
      const searchService = {
        search: () => Effect.succeed([]),
        getAutocompleteSuggestions: () =>
          Effect.fail(
            new SearchError({
              code: 'INDEX_UNAVAILABLE',
              query: 'test',
              message: 'Database unavailable',
            })
          ),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.showAutocomplete();

      expect(elements.autocompleteDropdown.classList.contains('active')).toBe(false);
    });
  });

  // ============================================================================
  // Test: Tag Filter Integration
  // ============================================================================

  describe('Tag Filter Integration', () => {
    it('should filter search results by selected tags', async () => {
      const allResults: SearchResult[] = [
        {
          bookmark: {
            id: 'bookmark-0',
            title: 'Tech Article',
            url: 'https://example.com/tech',
            createdAt: new Date(),
          },
          qaResults: [{ qa: mockQAPairs[0], score: 0.95 }],
          maxScore: 0.95,
        },
        {
          bookmark: {
            id: 'bookmark-1',
            title: 'Science Article',
            url: 'https://example.com/science',
            createdAt: new Date(),
          },
          qaResults: [{ qa: mockQAPairs[1], score: 0.90 }],
          maxScore: 0.90,
        },
      ];

      let requestedTags: ReadonlySet<string> | null = null;

      const searchService = {
        search: (query: string, selectedTags: ReadonlySet<string>) => {
          requestedTags = selectedTags;
          if (selectedTags.size > 0) {
            return Effect.succeed(
              allResults.filter((r) => selectedTags.has('tech') && r.bookmark.id === 'bookmark-0')
            );
          }
          return Effect.succeed(allResults);
        },
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      expect(elements.resultsList.children.length).toBe(2);

      (searchUI as any).selectedTags.add('tech');
      await searchUI.performSearch();

      expect(requestedTags).toEqual(new Set(['tech']));
      expect(elements.resultsList.children.length).toBe(1);
    });
  });

  // ============================================================================
  // Test: Error Handling in Search
  // ============================================================================

  describe('Error Handling in Search', () => {
    it('should display error message on search failure', async () => {
      const searchService = {
        search: () =>
          Effect.fail(
            new SearchError({
              code: 'EMBEDDING_FAILED',
              query: 'test query',
              message: 'Failed to generate embeddings',
            })
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test query';
      await searchUI.performSearch();

      expect(elements.resultStatus.textContent).toBe('Search failed');
      expect(elements.resultsList.querySelector('.error-message')).toBeTruthy();
      expect(elements.resultsList.querySelector('.error-message')?.textContent).toContain(
        'Failed to generate embeddings'
      );
    });

    it('should show API configuration error with settings link', async () => {
      const searchService = {
        search: () =>
          Effect.fail(
            new SearchError({
              code: 'EMBEDDING_FAILED',
              query: 'test',
              message: 'API key not configured',
            })
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      const errorDiv = elements.resultsList.querySelector('.error-message');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv?.textContent).toContain('API endpoint not configured');

      const settingsLink = errorDiv?.querySelector('.error-link') as HTMLAnchorElement;
      expect(settingsLink).toBeTruthy();
      expect(settingsLink.textContent).toBe('Configure in Settings');
      expect(settingsLink.href).toContain('options/options.html');
    });

    it('should handle index unavailable error', async () => {
      const searchService = {
        search: () =>
          Effect.fail(
            new SearchError({
              code: 'INDEX_UNAVAILABLE',
              query: 'test',
              message: 'Database not initialized',
            })
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      const errorDiv = elements.resultsList.querySelector('.error-message');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv?.textContent).toContain('Database not initialized');
      expect(errorDiv?.querySelector('.error-link')?.textContent).toBe('Check Settings');
    });

    it('should re-enable search button after error', async () => {
      const searchService = {
        search: () =>
          Effect.fail(
            new SearchError({
              code: 'UNKNOWN',
              query: 'test',
              message: 'Unknown error',
            })
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: () => Effect.void,
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test';
      await searchUI.performSearch();

      expect(elements.searchBtn.disabled).toBe(false);
      expect(elements.resultStatus.classList.contains('loading')).toBe(false);
    });
  });

  // ============================================================================
  // Test: Search History Persistence
  // ============================================================================

  describe('Search History Persistence', () => {
    it('should save search query and result count to history', async () => {
      let savedQuery: string | null = null;
      let savedCount: number | null = null;

      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed(mockQAPairs),
        bulkGetBookmarks: () =>
          Effect.succeed(createMockBookmarks(['bookmark-0', 'bookmark-1'])),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: (query: string, resultCount: number) => {
          savedQuery = query;
          savedCount = resultCount;
          return Effect.void;
        },
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: () => Effect.succeed([[0.5, 0.5, 0.3]]),
      });

      const searchService = {
        search: () =>
          Effect.provide(
            Effect.succeed([
              {
                bookmark: {
                  id: 'bookmark-1',
                  title: 'Result',
                  url: 'https://example.com/1',
                  createdAt: new Date(),
                },
                qaResults: [{ qa: mockQAPairs[0], score: 0.9 }],
                maxScore: 0.9,
              },
            ] as SearchResult[]),
            Layer.mergeAll(MockLoggingService, mockStorageService, mockApiService)
          ),
        getAutocompleteSuggestions: () => Effect.succeed([]),
        getSettings: () =>
          Effect.succeed({
            autocompleteEnabled: true,
            historyLimit: 100,
            autocompleteLimit: 5,
            topKResults: 100,
          }),
      };

      const storageService = {
        saveSearchHistory: (query: string, resultCount: number) =>
          Effect.provide(
            Effect.gen(function* () {
              const storage = yield* StorageService;
              return yield* storage.saveSearchHistory(query, resultCount);
            }),
            mockStorageService
          ),
      };

      searchUI = new SearchUI(elements, detailManager, searchService, storageService);

      elements.searchInput.value = 'test search query';
      await searchUI.performSearch();

      expect(savedQuery).toBe('test search query');
      expect(savedCount).toBe(1);
    });
  });
});
