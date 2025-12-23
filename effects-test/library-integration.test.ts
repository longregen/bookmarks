import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type { Bookmark, BookmarkTag } from '../effect/db/schema';

// ============================================================================
// Types
// ============================================================================

interface UIState {
  selectedTag: string;
  sortBy: string;
}

// ============================================================================
// Errors
// ============================================================================

class BookmarkRepositoryError extends Data.TaggedError('BookmarkRepositoryError')<{
  readonly operation: 'getAll' | 'getByTag' | 'getUntagged';
  readonly message: string;
  readonly cause?: unknown;
}> {}

class TagRepositoryError extends Data.TaggedError('TagRepositoryError')<{
  readonly operation: 'getAll' | 'getForBookmarks';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly getAll: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getByTag: (
      tagName: string
    ) => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getUntagged: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
  }
>() {}

class TagRepository extends Context.Tag('TagRepository')<
  TagRepository,
  {
    readonly getAll: () => Effect.Effect<BookmarkTag[], TagRepositoryError>;
    readonly getForBookmarks: (
      bookmarkIds: string[]
    ) => Effect.Effect<Map<string, BookmarkTag[]>, TagRepositoryError>;
    readonly getTaggedBookmarkIds: () => Effect.Effect<Set<string>, TagRepositoryError>;
  }
>() {}

class UIStateService extends Context.Tag('UIStateService')<
  UIStateService,
  {
    readonly getState: () => Effect.Effect<UIState, never>;
    readonly setState: (state: Partial<UIState>) => Effect.Effect<void, never>;
  }
>() {}

class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: {
        className?: string;
        textContent?: string;
        style?: Record<string, string>;
      }
    ) => any;
    readonly formatDateByAge: (date: Date) => string;
  }
>() {}

// ============================================================================
// Effects (simplified versions for testing)
// ============================================================================

interface MockElement {
  tagName: string;
  className: string;
  textContent: string;
  innerHTML: string;
  children: MockElement[];
  onclick: (() => void) | null;
  appendChild: (child: MockElement) => MockElement;
}

function loadBookmarksEffect(
  bookmarkList: MockElement,
  bookmarkCount: MockElement,
  state: UIState
): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError,
  BookmarkRepository | TagRepository
> {
  return Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const tagRepo = yield* TagRepository;

    let bookmarks: Bookmark[];
    if (state.selectedTag === 'All') {
      bookmarks = yield* bookmarkRepo.getAll();
    } else if (state.selectedTag === 'Untagged') {
      bookmarks = yield* bookmarkRepo.getUntagged();
    } else {
      bookmarks = yield* bookmarkRepo.getByTag(state.selectedTag);
    }

    // Sort bookmarks
    if (state.sortBy === 'newest') {
      bookmarks = [...bookmarks].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    } else if (state.sortBy === 'oldest') {
      bookmarks = [...bookmarks].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
    } else if (state.sortBy === 'title') {
      bookmarks = [...bookmarks].sort((a, b) => a.title.localeCompare(b.title));
    }

    // Update count
    bookmarkCount.textContent = bookmarks.length.toString();

    // Get tags for bookmarks (batch operation)
    const bookmarkIds = bookmarks.map((b) => b.id);
    const tagsByBookmarkId = yield* tagRepo.getForBookmarks(bookmarkIds);

    // Clear and render
    bookmarkList.innerHTML = '';
  });
}

function loadTagsEffect(): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError,
  BookmarkRepository | TagRepository
> {
  return Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const tagRepo = yield* TagRepository;

    const bookmarks = yield* bookmarkRepo.getAll();
    const allTags = yield* tagRepo.getAll();

    // Compute statistics
    const tagCounts = new Map<string, number>();
    const taggedBookmarkIds = new Set<string>();

    for (const tagRecord of allTags) {
      tagCounts.set(tagRecord.tagName, (tagCounts.get(tagRecord.tagName) || 0) + 1);
      taggedBookmarkIds.add(tagRecord.bookmarkId);
    }

    const totalBookmarks = bookmarks.length;
    const untaggedCount = totalBookmarks - taggedBookmarkIds.size;

    return;
  });
}

function initializeAppEffect(
  state: UIState
): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError,
  BookmarkRepository | TagRepository
> {
  return Effect.gen(function* () {
    // Load tags and bookmarks in parallel
    yield* Effect.all(
      [loadTagsEffect(), loadBookmarksEffect(
        { innerHTML: '', textContent: '', children: [] } as any,
        { textContent: '' } as any,
        state
      )],
      { concurrency: 'unbounded' }
    );
  });
}

// ============================================================================
// Test Data
// ============================================================================

const createMockBookmark = (
  id: string,
  title: string,
  status: 'complete' | 'pending' | 'processing' | 'error' = 'complete',
  createdAt: Date = new Date('2025-01-01')
): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title,
  html: `<html><body>${title}</body></html>`,
  status,
  createdAt,
  updatedAt: createdAt,
});

const createMockBookmarkTag = (
  bookmarkId: string,
  tagName: string,
  addedAt: Date = new Date('2025-01-01')
): BookmarkTag => ({
  bookmarkId,
  tagName,
  addedAt,
});

// ============================================================================
// Mock Storage
// ============================================================================

interface MockData {
  bookmarks: Bookmark[];
  tags: BookmarkTag[];
}

class MockLibraryStorage {
  private data: MockData;

  constructor(initialData: MockData) {
    this.data = {
      bookmarks: [...initialData.bookmarks],
      tags: [...initialData.tags],
    };
  }

  reset(newData: MockData): void {
    this.data = {
      bookmarks: [...newData.bookmarks],
      tags: [...newData.tags],
    };
  }

  getAllBookmarks(): Bookmark[] {
    return [...this.data.bookmarks];
  }

  getBookmarksByTag(tagName: string): Bookmark[] {
    const taggedBookmarkIds = this.data.tags
      .filter((t) => t.tagName === tagName)
      .map((t) => t.bookmarkId);
    return this.data.bookmarks.filter((b) => taggedBookmarkIds.includes(b.id));
  }

  getUntaggedBookmarks(): Bookmark[] {
    const taggedBookmarkIds = new Set(this.data.tags.map((t) => t.bookmarkId));
    return this.data.bookmarks.filter((b) => !taggedBookmarkIds.has(b.id));
  }

  getAllTags(): BookmarkTag[] {
    return [...this.data.tags];
  }

  getTagsForBookmarks(bookmarkIds: string[]): Map<string, BookmarkTag[]> {
    const tagsByBookmarkId = new Map<string, BookmarkTag[]>();

    for (const tag of this.data.tags) {
      if (bookmarkIds.includes(tag.bookmarkId)) {
        const existing = tagsByBookmarkId.get(tag.bookmarkId);
        if (existing) {
          existing.push(tag);
        } else {
          tagsByBookmarkId.set(tag.bookmarkId, [tag]);
        }
      }
    }

    return tagsByBookmarkId;
  }

  getTaggedBookmarkIds(): Set<string> {
    return new Set(this.data.tags.map((t) => t.bookmarkId));
  }
}

// ============================================================================
// Service Layers
// ============================================================================

const createMockBookmarkRepositoryLayer = (storage: MockLibraryStorage) =>
  Layer.succeed(BookmarkRepository, {
    getAll: () =>
      Effect.try({
        try: () => storage.getAllBookmarks(),
        catch: (error) =>
          new BookmarkRepositoryError({
            operation: 'getAll',
            message: 'Failed to fetch all bookmarks',
            cause: error,
          }),
      }),

    getByTag: (tagName: string) =>
      Effect.try({
        try: () => storage.getBookmarksByTag(tagName),
        catch: (error) =>
          new BookmarkRepositoryError({
            operation: 'getByTag',
            message: `Failed to fetch bookmarks for tag: ${tagName}`,
            cause: error,
          }),
      }),

    getUntagged: () =>
      Effect.try({
        try: () => storage.getUntaggedBookmarks(),
        catch: (error) =>
          new BookmarkRepositoryError({
            operation: 'getUntagged',
            message: 'Failed to fetch untagged bookmarks',
            cause: error,
          }),
      }),
  });

const createMockTagRepositoryLayer = (storage: MockLibraryStorage) =>
  Layer.succeed(TagRepository, {
    getAll: () =>
      Effect.try({
        try: () => storage.getAllTags(),
        catch: (error) =>
          new TagRepositoryError({
            operation: 'getAll',
            message: 'Failed to fetch all tags',
            cause: error,
          }),
      }),

    getForBookmarks: (bookmarkIds: string[]) =>
      Effect.try({
        try: () => storage.getTagsForBookmarks(bookmarkIds),
        catch: (error) =>
          new TagRepositoryError({
            operation: 'getForBookmarks',
            message: 'Failed to fetch tags for bookmarks',
            cause: error,
          }),
      }),

    getTaggedBookmarkIds: () =>
      Effect.try({
        try: () => storage.getTaggedBookmarkIds(),
        catch: (error) =>
          new TagRepositoryError({
            operation: 'getAll',
            message: 'Failed to fetch tagged bookmark IDs',
            cause: error,
          }),
      }),
  });

const createMockUIStateServiceLayer = (initialState: UIState) => {
  let currentState = { ...initialState };

  return Layer.succeed(UIStateService, {
    getState: () => Effect.succeed(currentState),
    setState: (state: Partial<UIState>) =>
      Effect.sync(() => {
        currentState = { ...currentState, ...state };
      }),
  });
};

const createMockDOMServiceLayer = () =>
  Layer.succeed(DOMService, {
    createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: {
        className?: string;
        textContent?: string;
        style?: Record<string, string>;
      }
    ) => ({
      tagName: tag.toUpperCase(),
      className: options?.className ?? '',
      textContent: options?.textContent ?? '',
      innerHTML: '',
      children: [],
      onclick: null,
      appendChild: (child: any) => child,
    }),

    formatDateByAge: (date: Date) => {
      const now = new Date('2025-01-15');
      const diffDays = Math.floor(
        (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      return `${diffDays} days ago`;
    },
  });

// ============================================================================
// Integration Tests
// ============================================================================

describe('Library UI Lifecycle Integration', () => {
  let storage: MockLibraryStorage;

  beforeEach(() => {
    // Initialize storage with test data
    const bookmarks = [
      createMockBookmark('bm-1', 'JavaScript Tutorial', 'complete', new Date('2025-01-10')),
      createMockBookmark('bm-2', 'React Guide', 'complete', new Date('2025-01-12')),
      createMockBookmark('bm-3', 'TypeScript Docs', 'complete', new Date('2025-01-11')),
      createMockBookmark('bm-4', 'Untagged Article', 'complete', new Date('2025-01-09')),
    ];

    const tags = [
      createMockBookmarkTag('bm-1', 'javascript'),
      createMockBookmarkTag('bm-1', 'tutorial'),
      createMockBookmarkTag('bm-2', 'javascript'),
      createMockBookmarkTag('bm-2', 'react'),
      createMockBookmarkTag('bm-3', 'typescript'),
    ];

    storage = new MockLibraryStorage({ bookmarks, tags });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // BookmarkRepository Tests
  // ==========================================================================

  describe('BookmarkRepository Mock', () => {
    it('should fetch all bookmarks', async () => {
      const testLayer = createMockBookmarkRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;
        return yield* repo.getAll();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(4);
      expect(result[0].title).toBe('JavaScript Tutorial');
    });

    it('should fetch bookmarks by tag', async () => {
      const testLayer = createMockBookmarkRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;
        return yield* repo.getByTag('javascript');
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(2);
      expect(result.map((b) => b.id)).toEqual(['bm-1', 'bm-2']);
    });

    it('should fetch untagged bookmarks', async () => {
      const testLayer = createMockBookmarkRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;
        return yield* repo.getUntagged();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bm-4');
    });
  });

  // ==========================================================================
  // TagRepository Tests
  // ==========================================================================

  describe('TagRepository Mock', () => {
    it('should fetch all tags', async () => {
      const testLayer = createMockTagRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* TagRepository;
        return yield* repo.getAll();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result).toHaveLength(5);
    });

    it('should fetch tags for specific bookmarks (batch operation)', async () => {
      const testLayer = createMockTagRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* TagRepository;
        return yield* repo.getForBookmarks(['bm-1', 'bm-2']);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result.size).toBe(2);
      expect(result.get('bm-1')).toHaveLength(2);
      expect(result.get('bm-2')).toHaveLength(2);
      expect(result.get('bm-1')?.map((t) => t.tagName)).toEqual([
        'javascript',
        'tutorial',
      ]);
    });

    it('should fetch tagged bookmark IDs', async () => {
      const testLayer = createMockTagRepositoryLayer(storage);

      const program = Effect.gen(function* () {
        const repo = yield* TagRepository;
        return yield* repo.getTaggedBookmarkIds();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(result.size).toBe(3);
      expect(result.has('bm-1')).toBe(true);
      expect(result.has('bm-2')).toBe(true);
      expect(result.has('bm-3')).toBe(true);
      expect(result.has('bm-4')).toBe(false);
    });
  });

  // ==========================================================================
  // Initial Load Effect Tests
  // ==========================================================================

  describe('Initial Load Effect', () => {
    it('should load tags with counts', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const program = loadTagsEffect();

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      // If it completes without error, the effect works
      expect(true).toBe(true);
    });

    it('should load bookmarks with tag filter', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const bookmarkList = {
        innerHTML: '',
        textContent: '',
        children: [],
      } as any;

      const bookmarkCount = {
        textContent: '',
      } as any;

      const program = loadBookmarksEffect(
        bookmarkList,
        bookmarkCount,
        { selectedTag: 'javascript', sortBy: 'newest' }
      );

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(bookmarkCount.textContent).toBe('2');
    });
  });

  // ==========================================================================
  // Parallel Loading with Effect.all
  // ==========================================================================

  describe('Parallel Loading (Effect.all)', () => {
    it('should load tags and bookmarks in parallel', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const executionLog: string[] = [];

      const tagLoadEffect = Effect.gen(function* () {
        const tagRepo = yield* TagRepository;
        executionLog.push('tags-start');
        const tags = yield* tagRepo.getAll();
        executionLog.push('tags-end');
        return tags;
      });

      const bookmarkLoadEffect = Effect.gen(function* () {
        const bookmarkRepo = yield* BookmarkRepository;
        executionLog.push('bookmarks-start');
        const bookmarks = yield* bookmarkRepo.getAll();
        executionLog.push('bookmarks-end');
        return bookmarks;
      });

      const program = Effect.all(
        [tagLoadEffect, bookmarkLoadEffect],
        { concurrency: 'unbounded' }
      );

      const [tags, bookmarks] = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(tags).toHaveLength(5);
      expect(bookmarks).toHaveLength(4);
      expect(executionLog).toContain('tags-start');
      expect(executionLog).toContain('bookmarks-start');
    });

    it('should initialize app with parallel data loading', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const program = initializeAppEffect({ selectedTag: 'All', sortBy: 'newest' });

      await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

      expect(true).toBe(true);
    });
  });

  // ==========================================================================
  // Bookmark Refresh on Events
  // ==========================================================================

  describe('Bookmark Refresh on Events', () => {
    it('should reload bookmarks and tags when data changes', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const initialLoad = Effect.gen(function* () {
        const bookmarkRepo = yield* BookmarkRepository;
        return yield* bookmarkRepo.getAll();
      });

      const initialBookmarks = await Effect.runPromise(
        initialLoad.pipe(Effect.provide(testLayer))
      );
      expect(initialBookmarks).toHaveLength(4);

      // Simulate data change
      storage.reset({
        bookmarks: [
          ...storage.getAllBookmarks(),
          createMockBookmark('bm-5', 'New Bookmark', 'complete'),
        ],
        tags: storage.getAllTags(),
      });

      const reloadEffect = Effect.gen(function* () {
        const bookmarkRepo = yield* BookmarkRepository;
        const tagRepo = yield* TagRepository;

        const [bookmarks, tags] = yield* Effect.all(
          [bookmarkRepo.getAll(), tagRepo.getAll()],
          { concurrency: 'unbounded' }
        );

        return { bookmarks, tags };
      });

      const reloadResult = await Effect.runPromise(
        reloadEffect.pipe(Effect.provide(testLayer))
      );

      expect(reloadResult.bookmarks).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Tag Filter Application Tests
  // ==========================================================================

  describe('Tag Filter Application', () => {
    it('should filter bookmarks by selected tag', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const bookmarkList = { innerHTML: '', children: [] } as any;
      const bookmarkCount = { textContent: '' } as any;

      // Load with 'All' filter
      const allProgram = loadBookmarksEffect(
        bookmarkList,
        bookmarkCount,
        { selectedTag: 'All', sortBy: 'newest' }
      );

      await Effect.runPromise(allProgram.pipe(Effect.provide(testLayer)));
      expect(bookmarkCount.textContent).toBe('4');

      // Load with 'javascript' filter
      const jsProgram = loadBookmarksEffect(
        bookmarkList,
        bookmarkCount,
        { selectedTag: 'javascript', sortBy: 'newest' }
      );

      await Effect.runPromise(jsProgram.pipe(Effect.provide(testLayer)));
      expect(bookmarkCount.textContent).toBe('2');

      // Load with 'Untagged' filter
      const untaggedProgram = loadBookmarksEffect(
        bookmarkList,
        bookmarkCount,
        { selectedTag: 'Untagged', sortBy: 'newest' }
      );

      await Effect.runPromise(untaggedProgram.pipe(Effect.provide(testLayer)));
      expect(bookmarkCount.textContent).toBe('1');
    });

    it('should handle switching between multiple tag filters', async () => {
      const testLayer = Layer.mergeAll(
        createMockBookmarkRepositoryLayer(storage),
        createMockTagRepositoryLayer(storage)
      );

      const program = Effect.gen(function* () {
        const bookmarkRepo = yield* BookmarkRepository;

        const results: Array<{ tag: string; count: number }> = [];

        const allBookmarks = yield* bookmarkRepo.getAll();
        results.push({ tag: 'All', count: allBookmarks.length });

        const jsBookmarks = yield* bookmarkRepo.getByTag('javascript');
        results.push({ tag: 'javascript', count: jsBookmarks.length });

        const tsBookmarks = yield* bookmarkRepo.getByTag('typescript');
        results.push({ tag: 'typescript', count: tsBookmarks.length });

        const untaggedBookmarks = yield* bookmarkRepo.getUntagged();
        results.push({ tag: 'Untagged', count: untaggedBookmarks.length });

        return results;
      });

      const results = await Effect.runPromise(
        program.pipe(Effect.provide(testLayer))
      );

      expect(results).toEqual([
        { tag: 'All', count: 4 },
        { tag: 'javascript', count: 2 },
        { tag: 'typescript', count: 1 },
        { tag: 'Untagged', count: 1 },
      ]);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle BookmarkRepositoryError gracefully', async () => {
      const failingLayer = Layer.succeed(BookmarkRepository, {
        getAll: () =>
          Effect.fail(
            new BookmarkRepositoryError({
              operation: 'getAll',
              message: 'Database connection failed',
            })
          ),
        getByTag: () => Effect.succeed([]),
        getUntagged: () => Effect.succeed([]),
      });

      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;
        return yield* repo.getAll();
      });

      const result = await Effect.runPromise(
        Effect.either(program.pipe(Effect.provide(failingLayer)))
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(BookmarkRepositoryError);
        expect(result.left.operation).toBe('getAll');
      }
    });

    it('should handle TagRepositoryError gracefully', async () => {
      const failingLayer = Layer.succeed(TagRepository, {
        getAll: () =>
          Effect.fail(
            new TagRepositoryError({
              operation: 'getAll',
              message: 'Failed to fetch tags',
            })
          ),
        getForBookmarks: () => Effect.succeed(new Map()),
        getTaggedBookmarkIds: () => Effect.succeed(new Set()),
      });

      const program = Effect.gen(function* () {
        const repo = yield* TagRepository;
        return yield* repo.getAll();
      });

      const result = await Effect.runPromise(
        Effect.either(program.pipe(Effect.provide(failingLayer)))
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(TagRepositoryError);
        expect(result.left.operation).toBe('getAll');
      }
    });
  });
});
