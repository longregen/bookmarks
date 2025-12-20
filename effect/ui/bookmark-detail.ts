import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Layer from 'effect/Layer';
import type { Bookmark, Markdown, QuestionAnswer } from '../db/schema';
import { createElement, setSanitizedHTML } from './dom';
import { formatDateByAge } from '../lib/date-format';
import { parseMarkdown } from '../lib/markdown';

// ============================================================================
// Errors
// ============================================================================

export class BookmarkNotFoundError extends Data.TaggedError('BookmarkNotFoundError')<{
  readonly bookmarkId: string;
}> {}

export class BookmarkOperationError extends Data.TaggedError('BookmarkOperationError')<{
  readonly operation: 'delete' | 'export' | 'retry' | 'fetch';
  readonly bookmarkId: string | null;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DOMOperationError extends Data.TaggedError('DOMOperationError')<{
  readonly operation: string;
  readonly message: string;
}> {}

// ============================================================================
// Services
// ============================================================================

export interface BookmarkData {
  readonly bookmark: Bookmark;
  readonly markdown: Markdown | null;
  readonly qaPairs: QuestionAnswer[];
}

export class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly getBookmark: (
      id: string
    ) => Effect.Effect<Bookmark, BookmarkNotFoundError>;
    readonly getBookmarkWithContent: (
      id: string
    ) => Effect.Effect<BookmarkData, BookmarkNotFoundError>;
    readonly deleteBookmark: (
      id: string
    ) => Effect.Effect<void, BookmarkOperationError>;
  }
>() {}

export class ExportService extends Context.Tag('ExportService')<
  ExportService,
  {
    readonly exportBookmark: (
      id: string
    ) => Effect.Effect<string, BookmarkOperationError>;
    readonly downloadExport: (data: string) => Effect.Effect<void, never>;
  }
>() {}

export class JobService extends Context.Tag('JobService')<
  JobService,
  {
    readonly retryBookmark: (
      id: string
    ) => Effect.Effect<void, BookmarkOperationError>;
    readonly triggerProcessingQueue: () => Effect.Effect<void, never>;
  }
>() {}

export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly createElement: typeof createElement;
    readonly setSanitizedHTML: typeof setSanitizedHTML;
    readonly formatDateByAge: typeof formatDateByAge;
    readonly parseMarkdown: typeof parseMarkdown;
    readonly confirm: (message: string) => Effect.Effect<boolean, never>;
    readonly alert: (message: string) => Effect.Effect<void, never>;
  }
>() {}

export class TagEditorService extends Context.Tag('TagEditorService')<
  TagEditorService,
  {
    readonly createTagEditor: (config: {
      readonly bookmarkId: string;
      readonly container: HTMLElement;
      readonly onTagsChange?: () => void;
    }) => Effect.Effect<void, never>;
  }
>() {}

// ============================================================================
// Configuration
// ============================================================================

export interface BookmarkDetailConfig {
  readonly detailPanel: HTMLElement;
  readonly detailBackdrop: HTMLElement;
  readonly detailContent: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
  readonly deleteBtn: HTMLButtonElement;
  readonly exportBtn: HTMLButtonElement;
  readonly debugBtn: HTMLButtonElement;
  readonly retryBtn?: HTMLButtonElement;
  readonly onDelete?: () => void;
  readonly onTagsChange?: () => void;
  readonly onRetry?: () => void;
}

// ============================================================================
// Bookmark Detail Manager (Effect-based)
// ============================================================================

export class BookmarkDetailManager {
  private currentBookmarkId: string | null = null;

  constructor(private readonly config: BookmarkDetailConfig) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.config.closeBtn.addEventListener('click', () => this.closeDetail());
    this.config.detailBackdrop.addEventListener('click', () => this.closeDetail());
    this.config.deleteBtn.addEventListener('click', () => {
      void this.runEffect(this.deleteCurrentBookmarkEffect());
    });
    this.config.exportBtn.addEventListener('click', () => {
      void this.runEffect(this.exportCurrentBookmarkEffect());
    });
    this.config.debugBtn.addEventListener('click', () => {
      void this.runEffect(this.debugCurrentBookmarkEffect());
    });
    if (this.config.retryBtn) {
      this.config.retryBtn.addEventListener('click', () => {
        void this.runEffect(this.retryCurrentBookmarkEffect());
      });
    }
  }

  async showDetail(bookmarkId: string): Promise<void> {
    this.currentBookmarkId = bookmarkId;
    await this.runEffect(this.showDetailEffect(bookmarkId));
  }

  closeDetail(): void {
    this.config.detailPanel.classList.remove('active');
    this.config.detailBackdrop.classList.remove('active');
    this.currentBookmarkId = null;
  }

  async deleteCurrentBookmark(): Promise<void> {
    await this.runEffect(this.deleteCurrentBookmarkEffect());
  }

  async exportCurrentBookmark(): Promise<void> {
    await this.runEffect(this.exportCurrentBookmarkEffect());
  }

  async debugCurrentBookmark(): Promise<void> {
    await this.runEffect(this.debugCurrentBookmarkEffect());
  }

  async retryCurrentBookmark(): Promise<void> {
    await this.runEffect(this.retryCurrentBookmarkEffect());
  }

  // ============================================================================
  // Effect-based operations
  // ============================================================================

  private showDetailEffect(
    bookmarkId: string
  ): Effect.Effect<
    void,
    BookmarkNotFoundError | DOMOperationError,
    BookmarkRepository | DOMService | TagEditorService
  > {
    return Effect.gen(this, function* () {
      const bookmarkRepo = yield* BookmarkRepository;
      const domService = yield* DOMService;
      const tagEditorService = yield* TagEditorService;

      const { bookmark, markdown, qaPairs } = yield* bookmarkRepo.getBookmarkWithContent(
        bookmarkId
      );

      // Show/hide retry button based on status
      if (this.config.retryBtn) {
        this.config.retryBtn.style.display = bookmark.status === 'error' ? '' : 'none';
      }

      // Build all content in a document fragment to minimize DOM reflows
      const fragment = document.createDocumentFragment();

      fragment.appendChild(
        domService.createElement('h1', {
          textContent: bookmark.title,
          style: { marginTop: '0' },
        })
      );

      const meta = domService.createElement('div', {
        style: { marginBottom: 'var(--space-6)', color: 'var(--text-tertiary)' },
      });
      const url = domService.createElement('a', {
        href: bookmark.url,
        target: '_blank',
        textContent: bookmark.url,
        style: { color: 'var(--accent-link)' },
      });
      meta.appendChild(url);
      meta.appendChild(
        document.createTextNode(
          ` · ${domService.formatDateByAge(bookmark.createdAt)} · ${bookmark.status}`
        )
      );

      // Show error message if present
      if (
        bookmark.status === 'error' &&
        bookmark.errorMessage !== undefined &&
        bookmark.errorMessage !== ''
      ) {
        const errorDiv = domService.createElement('div', {
          style: {
            marginTop: 'var(--space-2)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--danger-bg, #fef2f2)',
            color: 'var(--danger-text, #dc2626)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
          },
          textContent: bookmark.errorMessage,
        });
        meta.appendChild(errorDiv);
      }

      fragment.appendChild(meta);

      const tagEditorContainer = domService.createElement('div', {
        style: { marginBottom: 'var(--space-6)' },
      });
      fragment.appendChild(tagEditorContainer);

      fragment.appendChild(
        domService.createElement('hr', {
          style: {
            border: 'none',
            borderTop: '1px solid var(--border-primary)',
            margin: 'var(--space-6) 0',
          },
        })
      );

      if (markdown) {
        const content = domService.createElement('div', { className: 'markdown-content' });
        domService.setSanitizedHTML(content, domService.parseMarkdown(markdown.content));
        fragment.appendChild(content);
      }

      if (qaPairs.length > 0) {
        const qaSection = domService.createElement('div', { className: 'qa-section' });
        qaSection.appendChild(
          domService.createElement('h2', {
            textContent: `Q&A PAIRS (${qaPairs.length})`,
          })
        );

        // Use inner fragment for QA pairs to batch nested appends
        const qaFragment = document.createDocumentFragment();
        for (const qa of qaPairs) {
          const pair = domService.createElement('div', { className: 'qa-pair' });
          pair.appendChild(
            domService.createElement('div', {
              className: 'qa-question',
              textContent: `Q: ${qa.question}`,
            })
          );
          pair.appendChild(
            domService.createElement('div', {
              className: 'qa-answer',
              textContent: `A: ${qa.answer}`,
            })
          );
          qaFragment.appendChild(pair);
        }
        qaSection.appendChild(qaFragment);
        fragment.appendChild(qaSection);
      }

      // Single DOM operation to update content
      this.config.detailContent.innerHTML = '';
      this.config.detailContent.appendChild(fragment);

      // Create tag editor after content is in DOM
      yield* tagEditorService.createTagEditor({
        bookmarkId,
        container: tagEditorContainer,
        onTagsChange: () => this.config.onTagsChange?.(),
      });

      this.config.detailPanel.classList.add('active');
      this.config.detailBackdrop.classList.add('active');
    });
  }

  private deleteCurrentBookmarkEffect(): Effect.Effect<
    void,
    BookmarkOperationError,
    BookmarkRepository | DOMService
  > {
    return Effect.gen(this, function* () {
      if (this.currentBookmarkId === null) {
        return;
      }

      const domService = yield* DOMService;
      const confirmed = yield* domService.confirm('Delete this bookmark?');

      if (!confirmed) {
        return;
      }

      const bookmarkRepo = yield* BookmarkRepository;
      yield* bookmarkRepo.deleteBookmark(this.currentBookmarkId);

      this.closeDetail();
      this.config.onDelete?.();
    });
  }

  private exportCurrentBookmarkEffect(): Effect.Effect<
    void,
    BookmarkOperationError,
    ExportService
  > {
    return Effect.gen(this, function* () {
      if (this.currentBookmarkId === null) {
        return;
      }

      this.config.exportBtn.disabled = true;
      this.config.exportBtn.textContent = 'Exporting...';

      try {
        const exportService = yield* ExportService;
        const data = yield* exportService.exportBookmark(this.currentBookmarkId);
        yield* exportService.downloadExport(data);
      } finally {
        this.config.exportBtn.disabled = false;
        this.config.exportBtn.textContent = 'Export';
      }
    });
  }

  private debugCurrentBookmarkEffect(): Effect.Effect<
    void,
    BookmarkNotFoundError,
    BookmarkRepository | DOMService
  > {
    return Effect.gen(this, function* () {
      if (this.currentBookmarkId === null) {
        return;
      }

      const bookmarkRepo = yield* BookmarkRepository;
      const domService = yield* DOMService;

      const bookmark = yield* bookmarkRepo.getBookmark(this.currentBookmarkId);

      yield* domService.alert(
        `HTML Length: ${bookmark.html.length} chars\nStatus: ${bookmark.status}\n\n${bookmark.html.slice(0, 500)}...`
      );
    });
  }

  private retryCurrentBookmarkEffect(): Effect.Effect<
    void,
    BookmarkOperationError,
    JobService
  > {
    return Effect.gen(this, function* () {
      if (this.currentBookmarkId === null) {
        return;
      }

      const retryBtn = this.config.retryBtn;
      if (retryBtn) {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying...';
      }

      try {
        const jobService = yield* JobService;
        yield* jobService.retryBookmark(this.currentBookmarkId);
        yield* jobService.triggerProcessingQueue();

        this.closeDetail();
        this.config.onRetry?.();
      } catch (error) {
        console.error('Failed to retry bookmark:', error);
        yield* Effect.sync(() => {
          alert('Failed to retry bookmark. Please try again.');
        });
      } finally {
        if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.textContent = 'Retry';
        }
      }
    });
  }

  // Helper to run effects with default runtime
  private async runEffect<A, E>(
    effect: Effect.Effect<A, E, BookmarkRepository | ExportService | JobService | DOMService | TagEditorService>
  ): Promise<A> {
    return Effect.runPromise(effect);
  }
}

// ============================================================================
// Default Layer Implementations
// ============================================================================

export const DOMServiceLive: Layer.Layer<DOMService, never, never> = Layer.succeed(
  DOMService,
  {
    createElement,
    setSanitizedHTML,
    formatDateByAge,
    parseMarkdown,
    confirm: (message: string) =>
      Effect.sync(() => {
        // eslint-disable-next-line no-alert
        return confirm(message);
      }),
    alert: (message: string) =>
      Effect.sync(() => {
        // eslint-disable-next-line no-alert
        alert(message);
      }),
  }
);
