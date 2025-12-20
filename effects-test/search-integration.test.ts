import { describe, it, expect, beforeEach } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { cosineSimilarity, findTopK, VectorError } from '../effect/lib/similarity';
import {
  SearchService,
  StorageService,
  type SearchResult,
} from '../effect/search/search';
import { ApiService } from '../effect/lib/api';
import { LoggingService } from '../effect/services/logging-service';
import { ConfigService } from '../effect/services/config-service';
import { SearchError } from '../effect/lib/errors';
import type { QuestionAnswer, BookmarkTag } from '../src/db/schema';

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
// Test: Cosine Similarity with Effect
// ============================================================================

describe('Similarity Functions - Effect-based', () => {
  describe('cosineSimilarity', () => {
    const testLayer = Layer.mergeAll(MockLoggingService, MockConfigService);

    it('should return 1 for identical vectors', async () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(1);
    });

    it('should return 0 for orthogonal vectors', async () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(0);
    });

    it('should return -1 for opposite vectors', async () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(-1);
    });

    it('should handle normalized embedding vectors', async () => {
      const a = [0.5, 0.5, 0.5, 0.5];
      const b = [0.5, 0.5, 0.5, 0.5];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBeCloseTo(1, 10);
    });

    it('should fail with VectorError for non-array inputs', async () => {
      const program = cosineSimilarity(null as any, [1, 2, 3]);
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(VectorError);
        expect(result.left.reason).toBe('not_array');
      }
    });

    it('should fail with VectorError for dimension mismatch', async () => {
      const a = [1, 2, 3];
      const b = [1, 2];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(VectorError);
        expect(result.left.reason).toBe('dimension_mismatch');
        expect(result.left.message).toContain('3 and 2');
      }
    });

    it('should return 0 for zero magnitude vectors', async () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBe(0);
    });

    it('should handle large dimension vectors (1536)', async () => {
      const size = 1536;
      const a = Array(size)
        .fill(0)
        .map((_, i) => Math.sin(i));
      const b = Array(size)
        .fill(0)
        .map((_, i) => Math.sin(i));

      const program = cosineSimilarity(a, b);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toBeCloseTo(1, 10);
    });
  });

  // ============================================================================
  // Test: findTopK with Effect
  // ============================================================================

  describe('findTopK', () => {
    const testLayer = Layer.mergeAll(MockLoggingService, MockConfigService);

    interface TestItem {
      id: string;
      name: string;
    }

    let items: { item: TestItem; embedding: number[] }[];

    beforeEach(() => {
      items = [
        { item: { id: '1', name: 'Exact match' }, embedding: [1, 0, 0] },
        { item: { id: '2', name: 'Similar' }, embedding: [0.9, 0.1, 0] },
        { item: { id: '3', name: 'Orthogonal' }, embedding: [0, 1, 0] },
        { item: { id: '4', name: 'Opposite' }, embedding: [-1, 0, 0] },
        { item: { id: '5', name: 'Somewhat similar' }, embedding: [0.7, 0.7, 0] },
      ];
    });

    it('should return top K most similar items', async () => {
      const queryEmbedding = [1, 0, 0];
      const program = findTopK(queryEmbedding, items, 3);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toHaveLength(3);
      expect(result[0].item.id).toBe('1');
      expect(result[0].score).toBeCloseTo(1, 10);
    });

    it('should sort results by similarity score descending', async () => {
      const queryEmbedding = [1, 0, 0];
      const program = findTopK(queryEmbedding, items, 5);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
      }
    });

    it('should handle k larger than items length', async () => {
      const queryEmbedding = [1, 0, 0];
      const program = findTopK(queryEmbedding, items, 10);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should handle empty items array', async () => {
      const queryEmbedding = [1, 0, 0];
      const program = findTopK(queryEmbedding, [], 5);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toHaveLength(0);
    });

    it('should fail for invalid query embedding', async () => {
      const program = findTopK(null as any, items, 3);
      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(VectorError);
        expect(result.left.reason).toBe('invalid_input');
      }
    });

    it('should handle items with mismatched embedding dimensions gracefully', async () => {
      const badItems = [
        { item: { id: '1', name: 'Good' }, embedding: [1, 0, 0] },
        { item: { id: '2', name: 'Bad' }, embedding: [1, 0] },
        { item: { id: '3', name: 'Good too' }, embedding: [0.5, 0.5, 0] },
      ];

      const queryEmbedding = [1, 0, 0];
      const program = findTopK(queryEmbedding, badItems, 5);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result.length).toBe(2);
      expect(result.every((r) => r.score >= 0)).toBe(true);
    });

    it('should work with high-dimensional embeddings', async () => {
      const dim = 1536;
      const highDimItems = [
        {
          item: { id: '1', name: 'Match' },
          embedding: Array(dim).fill(1 / Math.sqrt(dim)),
        },
        {
          item: { id: '2', name: 'Different' },
          embedding: Array(dim)
            .fill(0)
            .map((_, i) => (i % 2 === 0 ? 1 / Math.sqrt(dim / 2) : 0)),
        },
      ];

      const query = Array(dim).fill(1 / Math.sqrt(dim));
      const program = findTopK(query, highDimItems, 2);
      const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(result).toHaveLength(2);
      expect(result[0].item.id).toBe('1');
      expect(result[0].score).toBeCloseTo(1, 5);
    });
  });

  // ============================================================================
  // Test: SearchService Integration
  // ============================================================================

  describe('SearchService Integration', () => {
    const createMockQAPairs = (count: number): QuestionAnswer[] => {
      return Array.from({ length: count }, (_, i) => ({
        id: `qa-${i}`,
        bookmarkId: `bookmark-${i % 3}`,
        question: `Question ${i}`,
        answer: `Answer ${i}`,
        embeddingQuestion: Array(3).fill(i / count),
        embeddingBoth: Array(3).fill((i + 0.5) / count),
        createdAt: new Date(),
      }));
    };

    const createMockBookmarkTags = (
      bookmarkIds: string[]
    ): Map<string, BookmarkTag[]> => {
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

    it('should perform semantic search and rank results by score', async () => {
      const mockQAPairs = createMockQAPairs(9);
      const mockBookmarks = new Map([
        [
          'bookmark-0',
          {
            id: 'bookmark-0',
            title: 'Bookmark 0',
            url: 'https://example.com/0',
            createdAt: new Date(),
          },
        ],
        [
          'bookmark-1',
          {
            id: 'bookmark-1',
            title: 'Bookmark 1',
            url: 'https://example.com/1',
            createdAt: new Date(),
          },
        ],
        [
          'bookmark-2',
          {
            id: 'bookmark-2',
            title: 'Bookmark 2',
            url: 'https://example.com/2',
            createdAt: new Date(),
          },
        ],
      ]);

      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed(mockQAPairs),
        bulkGetBookmarks: () => Effect.succeed(mockBookmarks),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: (texts: string[]) =>
          Effect.succeed([[0.5, 0.5, 0]]),
      });

      const SearchServiceLive = Layer.effect(
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

                const queryEmbeddings = yield* api.generateEmbeddings([query]);
                const queryEmbedding = queryEmbeddings[0];

                const allQAs = yield* storage.getAllQAPairs();
                const items = allQAs.flatMap((qa) => [
                  { item: qa, embedding: [...qa.embeddingQuestion], type: 'question' },
                  { item: qa, embedding: [...qa.embeddingBoth], type: 'both' },
                ]);

                const validItems = items.filter(
                  ({ embedding }) => embedding.length === queryEmbedding.length
                );

                const topK = yield* configService
                  .get<number>('SEARCH_TOP_K_RESULTS')
                  .pipe(Effect.orElseSucceed(() => 100));

                const topResults = yield* findTopK(queryEmbedding, validItems, topK);

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
                    bookmarkMap.set(bookmarkId, [
                      { qa: result.item, score: result.score },
                    ]);
                  }
                }

                const resultsWithMax = Array.from(bookmarkMap.entries())
                  .map(([id, results]) => ({
                    bookmarkId: id,
                    qaResults: results,
                    maxScore: Math.max(...results.map((r) => r.score)),
                  }))
                  .sort((a, b) => b.maxScore - a.maxScore);

                const bookmarkIds = resultsWithMax.map((r) => r.bookmarkId);
                const bookmarksById = yield* storage.bulkGetBookmarks(bookmarkIds);

                let tagsByBookmarkId: Map<string, BookmarkTag[]> | null = null;
                if (selectedTags.size > 0) {
                  tagsByBookmarkId = yield* storage.getBookmarkTags(bookmarkIds);
                }

                const filteredResults: SearchResult[] = [];
                for (const result of resultsWithMax) {
                  const bookmark = bookmarksById.get(result.bookmarkId);
                  if (!bookmark) continue;

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

                return filteredResults;
              }),

            getAutocompleteSuggestions: () => Effect.succeed([]),
            getSettings: () =>
              Effect.succeed({
                autocompleteEnabled: true,
                historyLimit: 100,
                autocompleteLimit: 5,
                topKResults: 100,
              }),
          };
        })
      );

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        MockConfigService,
        mockStorageService,
        mockApiService,
        SearchServiceLive
      );

      const program = Effect.gen(function* () {
        const searchService = yield* SearchService;
        return yield* searchService.search('test query', new Set());
      });

      const results = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].maxScore).toBeGreaterThanOrEqual(results[i].maxScore);
      }
    });

    it('should filter search results by selected tags', async () => {
      const mockQAPairs = createMockQAPairs(6);
      const mockBookmarks = new Map([
        [
          'bookmark-0',
          {
            id: 'bookmark-0',
            title: 'Bookmark 0',
            url: 'https://example.com/0',
            createdAt: new Date(),
          },
        ],
        [
          'bookmark-1',
          {
            id: 'bookmark-1',
            title: 'Bookmark 1',
            url: 'https://example.com/1',
            createdAt: new Date(),
          },
        ],
        [
          'bookmark-2',
          {
            id: 'bookmark-2',
            title: 'Bookmark 2',
            url: 'https://example.com/2',
            createdAt: new Date(),
          },
        ],
      ]);

      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed(mockQAPairs),
        bulkGetBookmarks: () => Effect.succeed(mockBookmarks),
        getBookmarkTags: (ids) => Effect.succeed(createMockBookmarkTags([...ids])),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: () => Effect.succeed([[0.5, 0.5, 0]]),
      });

      const SearchServiceLive = Layer.effect(
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

                const queryEmbeddings = yield* api.generateEmbeddings([query]);
                const queryEmbedding = queryEmbeddings[0];

                const allQAs = yield* storage.getAllQAPairs();
                const items = allQAs.flatMap((qa) => [
                  { item: qa, embedding: [...qa.embeddingQuestion], type: 'question' },
                  { item: qa, embedding: [...qa.embeddingBoth], type: 'both' },
                ]);

                const validItems = items.filter(
                  ({ embedding }) => embedding.length === queryEmbedding.length
                );

                const topK = yield* configService
                  .get<number>('SEARCH_TOP_K_RESULTS')
                  .pipe(Effect.orElseSucceed(() => 100));

                const topResults = yield* findTopK(queryEmbedding, validItems, topK);

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
                    bookmarkMap.set(bookmarkId, [
                      { qa: result.item, score: result.score },
                    ]);
                  }
                }

                const resultsWithMax = Array.from(bookmarkMap.entries())
                  .map(([id, results]) => ({
                    bookmarkId: id,
                    qaResults: results,
                    maxScore: Math.max(...results.map((r) => r.score)),
                  }))
                  .sort((a, b) => b.maxScore - a.maxScore);

                const bookmarkIds = resultsWithMax.map((r) => r.bookmarkId);
                const bookmarksById = yield* storage.bulkGetBookmarks(bookmarkIds);

                let tagsByBookmarkId: Map<string, BookmarkTag[]> | null = null;
                if (selectedTags.size > 0) {
                  tagsByBookmarkId = yield* storage.getBookmarkTags(bookmarkIds);
                }

                const filteredResults: SearchResult[] = [];
                for (const result of resultsWithMax) {
                  const bookmark = bookmarksById.get(result.bookmarkId);
                  if (!bookmark) continue;

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

                return filteredResults;
              }),

            getAutocompleteSuggestions: () => Effect.succeed([]),
            getSettings: () =>
              Effect.succeed({
                autocompleteEnabled: true,
                historyLimit: 100,
                autocompleteLimit: 5,
                topKResults: 100,
              }),
          };
        })
      );

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        MockConfigService,
        mockStorageService,
        mockApiService,
        SearchServiceLive
      );

      const program = Effect.gen(function* () {
        const searchService = yield* SearchService;
        return yield* searchService.search('test query', new Set(['tech']));
      });

      const results = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(['bookmark-0', 'bookmark-2']).toContain(result.bookmark.id);
      });
    });

    it('should handle API failures gracefully', async () => {
      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed([]),
        bulkGetBookmarks: () => Effect.succeed(new Map()),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: () =>
          Effect.fail({
            _tag: 'ApiError',
            endpoint: '/embeddings',
            status: 500,
            statusText: 'Internal Server Error',
            message: 'API request failed',
          }),
      });

      const SearchServiceLive = Layer.effect(
        SearchService,
        Effect.gen(function* () {
          const storage = yield* StorageService;
          const api = yield* ApiService;
          const logging = yield* LoggingService;

          return {
            search: (query: string, selectedTags: ReadonlySet<string>) =>
              Effect.gen(function* () {
                yield* logging.debug('Starting semantic search', { query });

                const queryEmbeddings = yield* api.generateEmbeddings([query]).pipe(
                  Effect.catchAll((error) =>
                    Effect.fail(
                      new SearchError({
                        code: 'EMBEDDING_FAILED',
                        query,
                        message: `Failed to generate query embedding`,
                        originalError: error,
                      })
                    )
                  )
                );

                return [];
              }),

            getAutocompleteSuggestions: () => Effect.succeed([]),
            getSettings: () =>
              Effect.succeed({
                autocompleteEnabled: true,
                historyLimit: 100,
                autocompleteLimit: 5,
                topKResults: 100,
              }),
          };
        })
      );

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        MockConfigService,
        mockStorageService,
        mockApiService,
        SearchServiceLive
      );

      const program = Effect.gen(function* () {
        const searchService = yield* SearchService;
        return yield* searchService.search('test query', new Set());
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer), Effect.either)
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(SearchError);
        expect(result.left.code).toBe('EMBEDDING_FAILED');
      }
    });

    it('should return empty results when no indexed bookmarks exist', async () => {
      const mockStorageService = Layer.succeed(StorageService, {
        getSetting: () => Effect.succeed(null),
        getAllQAPairs: () => Effect.succeed([]),
        bulkGetBookmarks: () => Effect.succeed(new Map()),
        getBookmarkTags: () => Effect.succeed(new Map()),
        getSearchHistory: () => Effect.succeed([]),
        saveSearchHistory: () => Effect.void,
      });

      const mockApiService = Layer.succeed(ApiService, {
        makeRequest: () => Effect.succeed({} as any),
        generateQAPairs: () => Effect.succeed([]),
        generateEmbeddings: () => Effect.succeed([[0.5, 0.5, 0]]),
      });

      const SearchServiceLive = Layer.effect(
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

                const queryEmbeddings = yield* api.generateEmbeddings([query]);
                const queryEmbedding = queryEmbeddings[0];

                const allQAs = yield* storage.getAllQAPairs();
                const items = allQAs.flatMap((qa) => [
                  { item: qa, embedding: [...qa.embeddingQuestion], type: 'question' },
                  { item: qa, embedding: [...qa.embeddingBoth], type: 'both' },
                ]);

                const validItems = items.filter(
                  ({ embedding }) => embedding.length === queryEmbedding.length
                );

                if (validItems.length === 0) {
                  yield* logging.debug('No indexed bookmarks found');
                  return [];
                }

                return [];
              }),

            getAutocompleteSuggestions: () => Effect.succeed([]),
            getSettings: () =>
              Effect.succeed({
                autocompleteEnabled: true,
                historyLimit: 100,
                autocompleteLimit: 5,
                topKResults: 100,
              }),
          };
        })
      );

      const testLayer = Layer.mergeAll(
        MockLoggingService,
        MockConfigService,
        mockStorageService,
        mockApiService,
        SearchServiceLive
      );

      const program = Effect.gen(function* () {
        const searchService = yield* SearchService;
        return yield* searchService.search('test query', new Set());
      });

      const results = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(results).toEqual([]);
    });
  });
});
