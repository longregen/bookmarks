import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { db, type BookmarkTag, type Bookmark, type QuestionAnswer } from '../../src/db/schema';
import { createElement, getElement } from '../../src/ui/dom';
import { formatDateByAge } from '../../src/lib/date-format';
import { getErrorMessage } from '../../src/lib/errors';
import { BookmarkDetailManager } from '../../src/ui/bookmark-detail';
import { loadTagFilters } from '../../src/ui/tag-filter';
import { config } from '../../src/lib/config-registry';
import {
  BookmarkRepository,
  TagRepository,
  BookmarkRepositoryError,
  TagRepositoryError,
  RepositoryLayerLive,
} from '../services/repository-services';
import { initializeUI } from '../shared/ui-init';
import { setupBookmarkEventHandlers } from '../shared/event-handling';
import { getStatusModifier } from '../shared/rendering';

// ============================================================================
// Typed Errors
// ============================================================================

export class StumbleLoadError extends Data.TaggedError('StumbleLoadError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TagFilterError extends Data.TaggedError('TagFilterError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ShuffleError extends Data.TaggedError('ShuffleError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Service Definitions
// ============================================================================

/**
 * Service for stumble-specific database operations
 */
export class StumbleDataService extends Context.Tag('StumbleDataService')<
  StumbleDataService,
  {
    /**
     * Get all complete bookmarks
     */
    getCompleteBookmarks(): Effect.Effect<Bookmark[], StumbleLoadError>;

    /**
     * Get bookmarks filtered by tag names
     */
    getBookmarksByTags(
      tagNames: string[]
    ): Effect.Effect<Set<string>, TagFilterError>;

    /**
     * Get Q&A pairs for multiple bookmarks in a single query
     */
    getQAPairsForBookmarks(
      bookmarkIds: string[]
    ): Effect.Effect<Map<string, QuestionAnswer[]>, StumbleLoadError>;
  }
>() {}

/**
 * Service for shuffling and selecting bookmarks
 */
export class ShuffleService extends Context.Tag('ShuffleService')<
  ShuffleService,
  {
    /**
     * Shuffle an array using Fisher-Yates algorithm
     */
    shuffle<T>(items: T[]): Effect.Effect<T[], ShuffleError>;

    /**
     * Select a random subset of items
     */
    selectRandom<T>(items: T[], count: number): Effect.Effect<T[], never>;
  }
>() {}

/**
 * Service for UI state management
 */
export class StumbleUIService extends Context.Tag('StumbleUIService')<
  StumbleUIService,
  {
    /**
     * Update shuffle button state
     */
    setShuffling(shuffling: boolean): Effect.Effect<void, never>;

    /**
     * Update result count display
     */
    setResultCount(count: number): Effect.Effect<void, never>;

    /**
     * Clear stumble list
     */
    clearStumbleList(): Effect.Effect<void, never>;

    /**
     * Show empty state message
     */
    showEmptyState(message: string): Effect.Effect<void, never>;

    /**
     * Show error message
     */
    showError(message: string): Effect.Effect<void, never>;

    /**
     * Render bookmark cards
     */
    renderBookmarks(
      bookmarks: Bookmark[],
      qaPairs: Map<string, QuestionAnswer[]>,
      detailManager: BookmarkDetailManager
    ): Effect.Effect<void, never>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

/**
 * Production implementation of StumbleDataService using shared repositories
 */
export const StumbleDataServiceLive = Layer.effect(
  StumbleDataService,
  Effect.gen(function* () {
    const bookmarkRepo = yield* BookmarkRepository;
    const tagRepo = yield* TagRepository;

    return {
      getCompleteBookmarks: () =>
        bookmarkRepo.getComplete().pipe(
          Effect.mapError(
            (error) =>
              new StumbleLoadError({
                message: error.message,
                cause: error.cause,
              })
          )
        ),

      getBookmarksByTags: (tagNames: string[]) =>
        tagRepo.getBookmarksByTags(tagNames).pipe(
          Effect.mapError(
            (error) =>
              new TagFilterError({
                message: error.message,
                cause: error.cause,
              })
          )
        ),

      getQAPairsForBookmarks: (bookmarkIds: string[]) =>
        Effect.tryPromise({
          try: async () => {
            const allQAPairs = await db.questionsAnswers
              .where('bookmarkId')
              .anyOf(bookmarkIds)
              .toArray();

            const qaPairsByBookmark = new Map<string, QuestionAnswer[]>();
            for (const qa of allQAPairs) {
              if (!qaPairsByBookmark.has(qa.bookmarkId)) {
                qaPairsByBookmark.set(qa.bookmarkId, []);
              }
              qaPairsByBookmark.get(qa.bookmarkId)!.push(qa);
            }
            return qaPairsByBookmark;
          },
          catch: (error) =>
            new StumbleLoadError({
              message: 'Failed to load Q&A pairs',
              cause: error,
            }),
        }),
    };
  })
);

/**
 * Production implementation of ShuffleService
 */
export const ShuffleServiceLive = Layer.succeed(ShuffleService, {
  shuffle: <T>(items: T[]) =>
    Effect.sync(() => {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }),

  selectRandom: <T>(items: T[], count: number) =>
    Effect.sync(() => items.slice(0, count)),
});

/**
 * Production implementation of StumbleUIService
 */
export const makeStumbleUIServiceLive = (
  shuffleBtn: HTMLButtonElement,
  resultCount: HTMLElement,
  stumbleList: HTMLElement
) =>
  Layer.succeed(StumbleUIService, {
    setShuffling: (shuffling: boolean) =>
      Effect.sync(() => {
        shuffleBtn.disabled = shuffling;
        shuffleBtn.textContent = shuffling ? 'Shuffling...' : '↻ Shuffle';
      }),

    setResultCount: (count: number) =>
      Effect.sync(() => {
        resultCount.textContent = count.toString();
      }),

    clearStumbleList: () =>
      Effect.sync(() => {
        stumbleList.innerHTML = '';
      }),

    showEmptyState: (message: string) =>
      Effect.sync(() => {
        stumbleList.innerHTML = '';
        stumbleList.appendChild(
          createElement('div', {
            className: 'empty-state',
            textContent: message,
          })
        );
      }),

    showError: (message: string) =>
      Effect.sync(() => {
        stumbleList.innerHTML = '';
        stumbleList.appendChild(
          createElement('div', {
            className: 'error-message',
            textContent: message,
          })
        );
      }),

    renderBookmarks: (
      bookmarks: Bookmark[],
      qaPairs: Map<string, QuestionAnswer[]>,
      detailManager: BookmarkDetailManager
    ) =>
      Effect.sync(() => {
        stumbleList.innerHTML = '';

        for (const bookmark of bookmarks) {
          const bookmarkQAPairs = qaPairs.get(bookmark.id) || [];
          const randomQA =
            bookmarkQAPairs.length > 0
              ? bookmarkQAPairs[
                  Math.floor(Math.random() * bookmarkQAPairs.length)
                ]
              : null;

          const card = createElement('div', { className: 'stumble-card' });
          card.onclick = () => detailManager.showDetail(bookmark.id);

          const header = createElement('div', { className: 'card-header' });
          header.appendChild(
            createElement('div', {
              className: 'card-title',
              textContent: bookmark.title,
            })
          );
          header.appendChild(
            createElement('div', {
              className: `status-dot ${getStatusModifier(bookmark.status)}`,
            })
          );
          card.appendChild(header);

          const meta = createElement('div', { className: 'card-meta' });
          const url = createElement('a', {
            className: 'card-url',
            href: bookmark.url,
            textContent: new URL(bookmark.url).hostname,
          });
          url.onclick = (e) => e.stopPropagation();
          meta.appendChild(url);
          card.appendChild(meta);

          const savedAgo = createElement('div', {
            className: 'saved-ago',
            textContent: `Saved ${formatDateByAge(bookmark.createdAt)}`,
          });
          card.appendChild(savedAgo);

          if (randomQA) {
            const qaPreview = createElement('div', {
              className: 'qa-preview',
              style: { marginTop: 'var(--space-3)' },
            });
            qaPreview.appendChild(
              createElement('div', {
                className: 'qa-q',
                textContent: `Q: ${randomQA.question}`,
              })
            );
            qaPreview.appendChild(
              createElement('div', {
                className: 'qa-a',
                textContent: `A: ${randomQA.answer}`,
              })
            );
            card.appendChild(qaPreview);
          }

          stumbleList.appendChild(card);
        }
      }),
  });

// ============================================================================
// Business Logic
// ============================================================================

/**
 * Load and display shuffled bookmarks
 */
export function loadStumbleEffect(
  selectedTags: Set<string>,
  detailManager: BookmarkDetailManager
): Effect.Effect<
  void,
  StumbleLoadError | TagFilterError | ShuffleError,
  StumbleDataService | ShuffleService | StumbleUIService
> {
  return Effect.gen(function* () {
    const dataService = yield* StumbleDataService;
    const shuffleService = yield* ShuffleService;
    const uiService = yield* StumbleUIService;

    // Set UI to shuffling state
    yield* uiService.setShuffling(true);

    try {
      // Load complete bookmarks
      let bookmarks = yield* dataService.getCompleteBookmarks();

      // Filter by tags if any selected
      if (selectedTags.size > 0) {
        const taggedIds = yield* dataService.getBookmarksByTags(
          Array.from(selectedTags)
        );
        bookmarks = bookmarks.filter((b) => taggedIds.has(b.id));
      }

      // Shuffle bookmarks
      const shuffled = yield* shuffleService.shuffle(bookmarks);

      // Select subset
      const selected = yield* shuffleService.selectRandom(
        shuffled,
        config.STUMBLE_COUNT
      );

      // Update result count
      yield* uiService.setResultCount(selected.length);

      // Clear existing content
      yield* uiService.clearStumbleList();

      // Show empty state if no bookmarks
      if (selected.length === 0) {
        yield* uiService.showEmptyState(
          'No complete bookmarks to stumble through'
        );
        return;
      }

      // Load Q&A pairs for selected bookmarks
      const bookmarkIds = selected.map((b) => b.id);
      const qaPairs = yield* dataService.getQAPairsForBookmarks(bookmarkIds);

      // Render bookmarks
      yield* uiService.renderBookmarks(selected, qaPairs, detailManager);
    } finally {
      // Always reset UI state
      yield* uiService.setShuffling(false);
    }
  });
}

/**
 * Load tag filters
 */
export function loadFiltersEffect(
  selectedTags: Set<string>,
  tagFilters: HTMLElement,
  onFiltersChange: () => void
): Effect.Effect<void, never, never> {
  return Effect.promise(() =>
    loadTagFilters({
      container: tagFilters,
      selectedTags,
      onChange: onFiltersChange,
    })
  );
}

// ============================================================================
// Application Runtime
// ============================================================================

/**
 * Initialize and run the stumble application
 */
export function runStumbleApp(): void {
  const selectedTags = new Set<string>();

  // DOM elements
  const tagFilters = getElement('tagFilters');
  const stumbleList = getElement('stumbleList');
  const shuffleBtn = getElement<HTMLButtonElement>('shuffleBtn');
  const resultCount = getElement('resultCount');

  const detailPanel = getElement('detailPanel');
  const detailBackdrop = getElement('detailBackdrop');
  const detailContent = getElement('detailContent');

  // Detail manager
  const detailManager = new BookmarkDetailManager({
    detailPanel,
    detailBackdrop,
    detailContent,
    closeBtn: getElement<HTMLButtonElement>('closeDetailBtn'),
    deleteBtn: getElement<HTMLButtonElement>('deleteBtn'),
    exportBtn: getElement<HTMLButtonElement>('exportBtn'),
    debugBtn: getElement<HTMLButtonElement>('debugBtn'),
    retryBtn: getElement<HTMLButtonElement>('retryBtn'),
    onDelete: () => void loadStumble(),
    onTagsChange: () => void loadFilters(),
    onRetry: () => void loadStumble(),
  });

  // Create runtime with all layers
  const StumbleAppLayer = Layer.mergeAll(
    ShuffleServiceLive,
    makeStumbleUIServiceLive(shuffleBtn, resultCount, stumbleList),
    StumbleDataServiceLive.pipe(Layer.provide(RepositoryLayerLive))
  );

  // Load filters function
  const loadFilters = () => {
    const effect = loadFiltersEffect(selectedTags, tagFilters, () => {
      void loadFilters();
      void loadStumble();
    });

    Effect.runPromise(effect).catch((error) => {
      console.error('Failed to load filters:', error);
    });
  };

  // Load stumble function
  const loadStumble = () => {
    const effect = loadStumbleEffect(selectedTags, detailManager).pipe(
      Effect.catchAll((error) => {
        const message =
          error instanceof StumbleLoadError ||
          error instanceof TagFilterError ||
          error instanceof ShuffleError
            ? error.message
            : getErrorMessage(error);

        console.error('Stumble error:', error);
        return Effect.gen(function* () {
          const uiService = yield* StumbleUIService;
          yield* uiService.showError(`Failed to load: ${message}`);
        });
      }),
      Effect.provide(StumbleAppLayer)
    );

    Effect.runPromise(effect).catch((error) => {
      console.error('Unhandled stumble error:', error);
    });
  };

  // Shuffle button click handler
  shuffleBtn.addEventListener('click', () => void loadStumble());

  // Initialize UI
  const healthIndicatorContainer = document.getElementById('healthIndicator');
  void initializeUI({ healthIndicatorContainer: healthIndicatorContainer || undefined });

  // Setup event handlers
  setupBookmarkEventHandlers({
    onTagChange: () => void loadFilters(),
  });

  // Initial load
  void loadFilters();
  void loadStumble();
}

// Run the application if this is the main entry point
// Skip during tests to avoid DOM initialization errors
if (typeof window !== 'undefined' && !import.meta.vitest) {
  runStumbleApp();
}
