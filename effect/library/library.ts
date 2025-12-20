import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import type { Bookmark, BookmarkTag } from '../db/schema';
import { db } from '../../src/db/schema';
import { getErrorMessage } from '../lib/errors';
import { createElement, getElement } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWeb } from '../web/init-web';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { createHealthIndicator } from '../ui/health-indicator';
import { BookmarkDetailManager } from '../ui/bookmark-detail';

// ============================================================================
// Errors
// ============================================================================

export class BookmarkRepositoryError extends Data.TaggedError('BookmarkRepositoryError')<{
  readonly operation: 'getAll' | 'getByTag' | 'getUntagged';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TagRepositoryError extends Data.TaggedError('TagRepositoryError')<{
  readonly operation: 'getAll' | 'getForBookmarks';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class UIStateError extends Data.TaggedError('UIStateError')<{
  readonly operation: 'getState' | 'setState';
  readonly message: string;
}> {}

export class DOMRenderError extends Data.TaggedError('DOMRenderError')<{
  readonly component: 'tags' | 'bookmarks' | 'detail';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Services
// ============================================================================

export interface BookmarkWithTags {
  readonly bookmark: Bookmark;
  readonly tags: BookmarkTag[];
}

export class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly getAll: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getByTag: (
      tagName: string
    ) => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getUntagged: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
  }
>() {}

export class TagRepository extends Context.Tag('TagRepository')<
  TagRepository,
  {
    readonly getAll: () => Effect.Effect<BookmarkTag[], TagRepositoryError>;
    readonly getForBookmarks: (
      bookmarkIds: string[]
    ) => Effect.Effect<Map<string, BookmarkTag[]>, TagRepositoryError>;
    readonly getTaggedBookmarkIds: () => Effect.Effect<Set<string>, TagRepositoryError>;
  }
>() {}

export interface UIState {
  selectedTag: string;
  sortBy: string;
}

export class UIStateService extends Context.Tag('UIStateService')<
  UIStateService,
  {
    readonly getState: () => Effect.Effect<UIState, never>;
    readonly setState: (state: Partial<UIState>) => Effect.Effect<void, never>;
  }
>() {}

export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly createElement: typeof createElement;
    readonly getElement: typeof getElement;
    readonly formatDateByAge: typeof formatDateByAge;
  }
>() {}

export class EventService extends Context.Tag('EventService')<
  EventService,
  {
    readonly addEventListener: (
      handler: (event: { type: string }) => void
    ) => Effect.Effect<() => void, never>;
  }
>() {}

export class ThemeService extends Context.Tag('ThemeService')<
  ThemeService,
  {
    readonly onThemeChange: (
      handler: (theme: string) => void
    ) => Effect.Effect<void, never>;
    readonly applyTheme: (theme: string) => Effect.Effect<void, never>;
  }
>() {}

export class HealthIndicatorService extends Context.Tag('HealthIndicatorService')<
  HealthIndicatorService,
  {
    readonly create: (container: HTMLElement) => Effect.Effect<() => void, never>;
  }
>() {}

// ============================================================================
// Tag Statistics
// ============================================================================

export interface TagStatistics {
  readonly tagCounts: Map<string, number>;
  readonly taggedBookmarkIds: Set<string>;
  readonly totalBookmarks: number;
  readonly untaggedCount: number;
}

function computeTagStatistics(
  bookmarks: Bookmark[],
  allTags: BookmarkTag[]
): TagStatistics {
  const tagCounts = new Map<string, number>();
  const taggedBookmarkIds = new Set<string>();

  for (const tagRecord of allTags) {
    tagCounts.set(tagRecord.tagName, (tagCounts.get(tagRecord.tagName) || 0) + 1);
    taggedBookmarkIds.add(tagRecord.bookmarkId);
  }

  const totalBookmarks = bookmarks.length;
  const untaggedCount = totalBookmarks - taggedBookmarkIds.size;

  return {
    tagCounts,
    taggedBookmarkIds,
    totalBookmarks,
    untaggedCount,
  };
}

// ============================================================================
// Effects
// ============================================================================

function getStatusModifier(status: string): string {
  const statusMap: Record<string, string> = {
    'complete': 'status-dot--success',
    'pending': 'status-dot--warning',
    'processing': 'status-dot--info',
    'error': 'status-dot--error'
  };
  return statusMap[status] || 'status-dot--warning';
}

function sortBookmarks(bookmarks: Bookmark[], sortBy: string): Bookmark[] {
  const sorted = [...bookmarks];

  if (sortBy === 'newest') {
    sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sortBy === 'oldest') {
    sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } else if (sortBy === 'title') {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  }

  return sorted;
}

export function loadTagsEffect(
  tagList: HTMLElement
): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError | UIStateError | DOMRenderError,
  BookmarkRepository | TagRepository | UIStateService | DOMService
> {
  return Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const tagRepo = yield* TagRepository;
    const uiState = yield* UIStateService;
    const dom = yield* DOMService;

    const bookmarks = yield* bookmarkRepo.getAll();
    const allTags = yield* tagRepo.getAll();
    const state = yield* uiState.getState();

    const stats = computeTagStatistics(bookmarks, allTags);

    const fragment = document.createDocumentFragment();

    // "All" tag
    const allTag = dom.createElement('div', {
      className: `tag-item ${state.selectedTag === 'All' ? 'active' : ''}`
    });
    allTag.onclick = () => {
      void Effect.runPromise(
        Effect.gen(function* () {
          yield* uiState.setState({ selectedTag: 'All' });
        })
      );
    };
    allTag.appendChild(dom.createElement('span', { className: 'tag-name', textContent: 'All' }));
    allTag.appendChild(dom.createElement('span', { className: 'tag-count', textContent: stats.totalBookmarks.toString() }));
    fragment.appendChild(allTag);

    // "Untagged" tag (if any untagged bookmarks exist)
    if (stats.untaggedCount > 0) {
      const untaggedTag = dom.createElement('div', {
        className: `tag-item ${state.selectedTag === 'Untagged' ? 'active' : ''}`
      });
      untaggedTag.onclick = () => {
        void Effect.runPromise(
          Effect.gen(function* () {
            yield* uiState.setState({ selectedTag: 'Untagged' });
          })
        );
      };
      untaggedTag.appendChild(dom.createElement('span', { className: 'tag-name', textContent: 'Untagged' }));
      untaggedTag.appendChild(dom.createElement('span', { className: 'tag-count', textContent: stats.untaggedCount.toString() }));
      fragment.appendChild(untaggedTag);
    }

    // Separator
    fragment.appendChild(dom.createElement('hr', {
      style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-3) 0' }
    }));

    // Individual tags (sorted alphabetically)
    const sortedTags = Array.from(stats.tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [tagName, count] of sortedTags) {
      const tagItem = dom.createElement('div', {
        className: `tag-item ${state.selectedTag === tagName ? 'active' : ''}`
      });
      tagItem.onclick = () => {
        void Effect.runPromise(
          Effect.gen(function* () {
            yield* uiState.setState({ selectedTag: tagName });
          })
        );
      };
      tagItem.appendChild(dom.createElement('span', { className: 'tag-name', textContent: `#${tagName}` }));
      tagItem.appendChild(dom.createElement('span', { className: 'tag-count', textContent: count.toString() }));
      fragment.appendChild(tagItem);
    }

    // Render to DOM
    tagList.innerHTML = '';
    tagList.appendChild(fragment);
  });
}

export function loadBookmarksEffect(
  bookmarkList: HTMLElement,
  bookmarkCount: HTMLElement,
  detailManager: BookmarkDetailManager
): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError | UIStateError | DOMRenderError,
  BookmarkRepository | TagRepository | UIStateService | DOMService
> {
  return Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const tagRepo = yield* TagRepository;
    const uiState = yield* UIStateService;
    const dom = yield* DOMService;

    const state = yield* uiState.getState();

    // Get bookmarks based on selected tag
    let bookmarks: Bookmark[];
    if (state.selectedTag === 'All') {
      bookmarks = yield* bookmarkRepo.getAll();
    } else if (state.selectedTag === 'Untagged') {
      bookmarks = yield* bookmarkRepo.getUntagged();
    } else {
      bookmarks = yield* bookmarkRepo.getByTag(state.selectedTag);
    }

    // Sort bookmarks
    bookmarks = sortBookmarks(bookmarks, state.sortBy);

    // Update count
    bookmarkCount.textContent = bookmarks.length.toString();

    // Handle empty state
    if (bookmarks.length === 0) {
      bookmarkList.innerHTML = '';
      bookmarkList.appendChild(dom.createElement('div', { className: 'empty-state', textContent: 'No bookmarks found' }));
      return;
    }

    // Get tags for all bookmarks (batch operation to avoid N+1)
    const bookmarkIds = bookmarks.map(b => b.id);
    const tagsByBookmarkId = yield* tagRepo.getForBookmarks(bookmarkIds);

    // Build bookmark cards
    const fragment = document.createDocumentFragment();

    for (const bookmark of bookmarks) {
      const tags = tagsByBookmarkId.get(bookmark.id) ?? [];
      const card = dom.createElement('div', { className: 'bookmark-card' });
      card.onclick = () => detailManager.showDetail(bookmark.id);

      // Header
      const header = dom.createElement('div', { className: 'card-header' });
      header.appendChild(dom.createElement('div', { className: 'card-title', textContent: bookmark.title }));
      header.appendChild(dom.createElement('div', { className: `status-dot ${getStatusModifier(bookmark.status)}` }));
      card.appendChild(header);

      // Meta
      const meta = dom.createElement('div', { className: 'card-meta' });
      const url = dom.createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
      url.onclick = (e) => e.stopPropagation();
      meta.appendChild(url);
      meta.appendChild(document.createTextNode(` · ${dom.formatDateByAge(bookmark.createdAt)}`));
      card.appendChild(meta);

      // Tags
      if (tags.length > 0) {
        const tagContainer = dom.createElement('div', { className: 'card-tags' });
        for (const tag of tags) {
          tagContainer.appendChild(dom.createElement('span', { className: 'tag-badge', textContent: `#${tag.tagName}` }));
        }
        card.appendChild(tagContainer);
      }

      fragment.appendChild(card);
    }

    // Render to DOM
    bookmarkList.innerHTML = '';
    bookmarkList.appendChild(fragment);
  });
}

export function initializeAppEffect(
  tagList: HTMLElement,
  bookmarkList: HTMLElement,
  bookmarkCount: HTMLElement,
  detailManager: BookmarkDetailManager,
  bookmarkIdParam: string | null
): Effect.Effect<
  void,
  BookmarkRepositoryError | TagRepositoryError | UIStateError | DOMRenderError,
  BookmarkRepository | TagRepository | UIStateService | DOMService
> {
  return Effect.gen(function* () {
    // Load tags and bookmarks in parallel
    yield* Effect.all(
      [
        loadTagsEffect(tagList),
        loadBookmarksEffect(bookmarkList, bookmarkCount, detailManager)
      ],
      { concurrency: 'unbounded' }
    );

    // Show detail if bookmark ID in URL
    if (bookmarkIdParam !== null && bookmarkIdParam !== '') {
      yield* Effect.promise(() => detailManager.showDetail(bookmarkIdParam));
    }
  });
}

// ============================================================================
// Library Manager
// ============================================================================

export interface LibraryConfig {
  readonly tagList: HTMLElement;
  readonly bookmarkList: HTMLElement;
  readonly bookmarkCount: HTMLElement;
  readonly sortSelect: HTMLSelectElement;
  readonly detailPanel: HTMLElement;
  readonly detailBackdrop: HTMLElement;
  readonly detailContent: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
  readonly deleteBtn: HTMLButtonElement;
  readonly exportBtn: HTMLButtonElement;
  readonly debugBtn: HTMLButtonElement;
  readonly retryBtn?: HTMLButtonElement;
  readonly healthIndicatorContainer?: HTMLElement;
}

export class LibraryManager {
  private uiState: UIState = {
    selectedTag: 'All',
    sortBy: 'newest'
  };

  private detailManager: BookmarkDetailManager;
  private removeEventListener: (() => void) | null = null;
  private healthCleanup: (() => void) | null = null;

  constructor(private readonly config: LibraryConfig) {
    this.detailManager = new BookmarkDetailManager({
      detailPanel: config.detailPanel,
      detailBackdrop: config.detailBackdrop,
      detailContent: config.detailContent,
      closeBtn: config.closeBtn,
      deleteBtn: config.deleteBtn,
      exportBtn: config.exportBtn,
      debugBtn: config.debugBtn,
      retryBtn: config.retryBtn,
      onDelete: () => {
        void this.reload();
      },
      onTagsChange: () => {
        void this.reload();
      },
      onRetry: () => {
        void this.reload();
      }
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Sort select change
    this.config.sortSelect.addEventListener('change', () => {
      this.uiState.sortBy = this.config.sortSelect.value;
      void this.runEffect(
        loadBookmarksEffect(
          this.config.bookmarkList,
          this.config.bookmarkCount,
          this.detailManager
        )
      );
    });

    // Bookmark/tag events
    this.removeEventListener = addBookmarkEventListener((event) => {
      if (event.type.startsWith('bookmark:') || event.type.startsWith('tag:')) {
        void this.reload();
      }
    });

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  async initialize(bookmarkIdParam: string | null): Promise<void> {
    // Setup theme
    onThemeChange((theme) => applyTheme(theme));

    // Initialize extension or web
    if (__IS_WEB__) {
      await initWeb();
    } else {
      await initExtension();
    }

    // Initialize health indicator
    if (this.config.healthIndicatorContainer) {
      this.healthCleanup = createHealthIndicator(this.config.healthIndicatorContainer);
    }

    // Load initial data
    await this.runEffect(
      initializeAppEffect(
        this.config.tagList,
        this.config.bookmarkList,
        this.config.bookmarkCount,
        this.detailManager,
        bookmarkIdParam
      )
    );

    // Setup test helpers
    this.setupTestHelpers();
  }

  private async reload(): Promise<void> {
    await this.runEffect(
      Effect.all(
        [
          loadTagsEffect(this.config.tagList),
          loadBookmarksEffect(
            this.config.bookmarkList,
            this.config.bookmarkCount,
            this.detailManager
          )
        ],
        { concurrency: 'unbounded' }
      )
    );
  }

  private cleanup(): void {
    this.removeEventListener?.();
    this.healthCleanup?.();
  }

  private async runEffect<A, E>(effect: Effect.Effect<A, E,
    BookmarkRepository | TagRepository | UIStateService | DOMService
  >): Promise<A> {
    const layer = this.createLayer();
    return Effect.runPromise(Effect.provide(effect, layer));
  }

  private createLayer(): Layer.Layer<
    BookmarkRepository | TagRepository | UIStateService | DOMService,
    never,
    never
  > {
    const bookmarkRepoLayer = Layer.succeed(BookmarkRepository, {
      getAll: () =>
        Effect.tryPromise({
          try: () => db.bookmarks.toArray(),
          catch: (error) =>
            new BookmarkRepositoryError({
              operation: 'getAll',
              message: 'Failed to fetch all bookmarks',
              cause: error,
            }),
        }),

      getByTag: (tagName: string) =>
        Effect.tryPromise({
          try: async () => {
            const tagRecords = await db.bookmarkTags
              .where('tagName')
              .equals(tagName)
              .toArray();
            const taggedIds = tagRecords.map((t) => t.bookmarkId);
            return await db.bookmarks.where('id').anyOf(taggedIds).toArray();
          },
          catch: (error) =>
            new BookmarkRepositoryError({
              operation: 'getByTag',
              message: `Failed to fetch bookmarks for tag: ${tagName}`,
              cause: error,
            }),
        }),

      getUntagged: () =>
        Effect.tryPromise({
          try: async () => {
            const allBookmarks = await db.bookmarks.toArray();
            const taggedIds = new Set(
              (await db.bookmarkTags.toArray()).map((t) => t.bookmarkId)
            );
            return allBookmarks.filter((b) => !taggedIds.has(b.id));
          },
          catch: (error) =>
            new BookmarkRepositoryError({
              operation: 'getUntagged',
              message: 'Failed to fetch untagged bookmarks',
              cause: error,
            }),
        }),
    });

    const tagRepoLayer = Layer.succeed(TagRepository, {
      getAll: () =>
        Effect.tryPromise({
          try: () => db.bookmarkTags.toArray(),
          catch: (error) =>
            new TagRepositoryError({
              operation: 'getAll',
              message: 'Failed to fetch all tags',
              cause: error,
            }),
        }),

      getForBookmarks: (bookmarkIds: string[]) =>
        Effect.tryPromise({
          try: async () => {
            const allTags = await db.bookmarkTags
              .where('bookmarkId')
              .anyOf(bookmarkIds)
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
            new TagRepositoryError({
              operation: 'getForBookmarks',
              message: 'Failed to fetch tags for bookmarks',
              cause: error,
            }),
        }),

      getTaggedBookmarkIds: () =>
        Effect.tryPromise({
          try: async () => {
            const allTags = await db.bookmarkTags.toArray();
            return new Set(allTags.map((t) => t.bookmarkId));
          },
          catch: (error) =>
            new TagRepositoryError({
              operation: 'getAll',
              message: 'Failed to fetch tagged bookmark IDs',
              cause: error,
            }),
        }),
    });

    const uiStateLayer = Layer.succeed(UIStateService, {
      getState: () => Effect.succeed(this.uiState),
      setState: (state) =>
        Effect.sync(() => {
          this.uiState = { ...this.uiState, ...state };
          void this.reload();
        }),
    });

    const domLayer = Layer.succeed(DOMService, {
      createElement,
      getElement,
      formatDateByAge,
    });

    return Layer.mergeAll(
      bookmarkRepoLayer,
      tagRepoLayer,
      uiStateLayer,
      domLayer
    );
  }

  private setupTestHelpers(): void {
    window.__testHelpers = {
      async getBookmarkStatus() {
        const bookmarks = await db.bookmarks.toArray();
        const markdown = await db.markdown.toArray();

        return {
          bookmarks: bookmarks.map((b) => ({
            id: b.id,
            title: b.title,
            url: b.url,
            status: b.status,
            errorMessage: b.errorMessage,
            createdAt: b.createdAt,
          })),
          markdown: markdown.map((m) => ({
            bookmarkId: m.bookmarkId,
            contentLength: m.content ? m.content.length : 0,
            contentPreview: m.content ? m.content.substring(0, 200) : '',
          })),
        };
      },
    };
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export function createLibrary(config: LibraryConfig): LibraryManager {
  return new LibraryManager(config);
}

// DOM elements
const tagList = getElement('tagList');
const bookmarkList = getElement('bookmarkList');
const bookmarkCount = getElement('bookmarkCount');
const sortSelect = getElement<HTMLSelectElement>('sortSelect');
const detailPanel = getElement('detailPanel');
const detailBackdrop = getElement('detailBackdrop');
const detailContent = getElement('detailContent');
const healthIndicatorContainer = document.getElementById('healthIndicator');

// URL params
const urlParams = new URLSearchParams(window.location.search);
const bookmarkIdParam = urlParams.get('bookmarkId');

// Initialize library
const library = createLibrary({
  tagList,
  bookmarkList,
  bookmarkCount,
  sortSelect,
  detailPanel,
  detailBackdrop,
  detailContent,
  closeBtn: getElement<HTMLButtonElement>('closeDetailBtn'),
  deleteBtn: getElement<HTMLButtonElement>('deleteBtn'),
  exportBtn: getElement<HTMLButtonElement>('exportBtn'),
  debugBtn: getElement<HTMLButtonElement>('debugBtn'),
  retryBtn: getElement<HTMLButtonElement>('retryBtn'),
  healthIndicatorContainer: healthIndicatorContainer ?? undefined
});

void library.initialize(bookmarkIdParam);

declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<unknown>;
    };
  }
}
