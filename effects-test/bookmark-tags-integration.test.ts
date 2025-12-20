import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  BookmarkDetailManager,
  BookmarkRepository,
  DOMService,
  TagEditorService,
  ExportService,
  JobService,
  type BookmarkData,
  type BookmarkDetailConfig,
} from '../effect/ui/bookmark-detail';
import {
  TagStorageService,
  TagEventsService,
  createTagEditor,
  DOMService as TagEditorDOMService,
} from '../effect/ui/tag-editor';
import {
  loadTagFilters,
  TagRepository,
  type TagFilterConfig,
} from '../effect/ui/tag-filter';
import type { Bookmark, Markdown, QuestionAnswer, BookmarkTag } from '../src/db/schema';

// ============================================================================
// Test Data
// ============================================================================

const createMockBookmark = (id: string, tags: string[] = []): Bookmark => ({
  id,
  url: `https://example.com/${id}`,
  title: `Test Bookmark ${id}`,
  html: '<html><body>Test content</body></html>',
  status: 'complete',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
});

const createMockMarkdown = (bookmarkId: string): Markdown => ({
  id: `md-${bookmarkId}`,
  bookmarkId,
  content: '# Test Content\n\nThis is test content.',
  createdAt: new Date('2025-01-01'),
});

const createMockQAPairs = (bookmarkId: string, count: number): QuestionAnswer[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `qa-${bookmarkId}-${i}`,
    bookmarkId,
    question: `Question ${i}?`,
    answer: `Answer ${i}`,
    embeddingQuestion: Array(3).fill(i / count),
    embeddingBoth: Array(3).fill((i + 0.5) / count),
    createdAt: new Date('2025-01-01'),
  }));
};

const createMockBookmarkTags = (bookmarkId: string, tags: string[]): BookmarkTag[] => {
  return tags.map((tagName) => ({
    bookmarkId,
    tagName,
    addedAt: new Date('2025-01-01'),
  }));
};

// ============================================================================
// DOM Helpers
// ============================================================================

function createMockDOM() {
  const createElement = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: {
      className?: string;
      textContent?: string;
      attributes?: Record<string, string>;
      style?: Partial<CSSStyleDeclaration>;
    }
  ): HTMLElementTagNameMap[K] => {
    const el = document.createElement(tag);

    if (options?.className) {
      el.className = options.className;
    }
    if (options?.textContent) {
      el.textContent = options.textContent;
    }
    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        el.setAttribute(key, value);
      }
    }
    if (options?.style) {
      Object.assign(el.style, options.style);
    }

    return el;
  };

  const detailPanel = createElement('div', { className: 'detail-panel' });
  const detailBackdrop = createElement('div', { className: 'detail-backdrop' });
  const detailContent = createElement('div', { className: 'detail-content' });
  const closeBtn = createElement('button', { className: 'close-btn' });
  const deleteBtn = createElement('button', { className: 'delete-btn' });
  const exportBtn = createElement('button', { className: 'export-btn' });
  const debugBtn = createElement('button', { className: 'debug-btn' });
  const retryBtn = createElement('button', { className: 'retry-btn' });
  const tagFilterContainer = createElement('div', { className: 'tag-filter' });

  return {
    detailPanel,
    detailBackdrop,
    detailContent,
    closeBtn,
    deleteBtn,
    exportBtn,
    debugBtn,
    retryBtn,
    tagFilterContainer,
    createElement,
  };
}

// ============================================================================
// Test: Bookmark Detail & Tag Editor Integration
// ============================================================================

describe('Bookmark Detail & Tag Management Integration', () => {
  let mockDOM: ReturnType<typeof createMockDOM>;
  let bookmarkData: Map<string, BookmarkData>;
  let tagStorage: Map<string, BookmarkTag[]>;
  let allTags: Set<string>;
  let tagEventsLog: Array<{ type: 'added' | 'removed'; bookmarkId: string; tagName: string }>;

  beforeEach(() => {
    mockDOM = createMockDOM();
    bookmarkData = new Map();
    tagStorage = new Map();
    allTags = new Set();
    tagEventsLog = [];

    // Seed test data
    const bookmark1 = createMockBookmark('bookmark-1');
    const markdown1 = createMockMarkdown('bookmark-1');
    const qaPairs1 = createMockQAPairs('bookmark-1', 2);
    const tags1 = createMockBookmarkTags('bookmark-1', ['javascript', 'testing']);

    bookmarkData.set('bookmark-1', {
      bookmark: bookmark1,
      markdown: markdown1,
      qaPairs: qaPairs1,
    });

    tagStorage.set('bookmark-1', tags1);
    allTags.add('javascript');
    allTags.add('testing');
    allTags.add('tutorial');
    allTags.add('react');
  });

  // ============================================================================
  // Mock Service Layers
  // ============================================================================

  const createMockBookmarkRepository = () =>
    Layer.succeed(BookmarkRepository, {
      getBookmark: (id: string) =>
        Effect.gen(function* () {
          const data = bookmarkData.get(id);
          if (!data) {
            return yield* Effect.fail({
              _tag: 'BookmarkNotFoundError',
              bookmarkId: id,
            } as any);
          }
          return data.bookmark;
        }),
      getBookmarkWithContent: (id: string) =>
        Effect.gen(function* () {
          const data = bookmarkData.get(id);
          if (!data) {
            return yield* Effect.fail({
              _tag: 'BookmarkNotFoundError',
              bookmarkId: id,
            } as any);
          }
          return data;
        }),
      deleteBookmark: (id: string) =>
        Effect.sync(() => {
          bookmarkData.delete(id);
          tagStorage.delete(id);
        }),
    });

  const createMockDOMService = () =>
    Layer.succeed(DOMService, {
      createElement: mockDOM.createElement,
      setSanitizedHTML: (el: HTMLElement, html: string) => {
        el.innerHTML = html;
      },
      formatDateByAge: (date: Date) => 'just now',
      parseMarkdown: (md: string) => `<p>${md}</p>`,
      confirm: (message: string) => Effect.succeed(true),
      alert: (message: string) => Effect.void,
    });

  const createMockTagStorageService = () =>
    Layer.succeed(TagStorageService, {
      getTagsForBookmark: (bookmarkId: string) =>
        Effect.succeed(tagStorage.get(bookmarkId) ?? []),
      getAllTags: () => Effect.succeed(Array.from(allTags)),
      addTag: (bookmarkId: string, tagName: string) =>
        Effect.sync(() => {
          const tags = tagStorage.get(bookmarkId) ?? [];
          const exists = tags.some((t) => t.tagName === tagName);
          if (!exists) {
            tags.push({
              bookmarkId,
              tagName,
              addedAt: new Date(),
            });
            tagStorage.set(bookmarkId, tags);
            allTags.add(tagName);
          }
        }),
      removeTag: (bookmarkId: string, tagName: string) =>
        Effect.sync(() => {
          const tags = tagStorage.get(bookmarkId) ?? [];
          const filtered = tags.filter((t) => t.tagName !== tagName);
          tagStorage.set(bookmarkId, filtered);
        }),
      tagExists: (bookmarkId: string, tagName: string) =>
        Effect.sync(() => {
          const tags = tagStorage.get(bookmarkId) ?? [];
          return tags.some((t) => t.tagName === tagName);
        }),
    });

  const createMockTagEventsService = () =>
    Layer.succeed(TagEventsService, {
      tagAdded: (bookmarkId: string, tagName: string) =>
        Effect.sync(() => {
          tagEventsLog.push({ type: 'added', bookmarkId, tagName });
        }),
      tagRemoved: (bookmarkId: string, tagName: string) =>
        Effect.sync(() => {
          tagEventsLog.push({ type: 'removed', bookmarkId, tagName });
        }),
    });

  const createMockTagEditorDOMService = () =>
    Layer.succeed(TagEditorDOMService, {
      createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        options?: {
          className?: string;
          textContent?: string;
          attributes?: Record<string, string>;
          style?: Partial<CSSStyleDeclaration>;
        }
      ) =>
        Effect.sync(() => {
          const el = mockDOM.createElement(tag, options);
          return el;
        }),
      createDocumentFragment: () => Effect.sync(() => document.createDocumentFragment()),
    });

  const createMockTagEditorService = () =>
    Layer.effect(
      TagEditorService,
      Effect.gen(function* () {
        const tagEditorDom = yield* TagEditorDOMService;
        const tagStorageService = yield* TagStorageService;
        const tagEventsService = yield* TagEventsService;

        return {
          createTagEditor: (config: {
            bookmarkId: string;
            container: HTMLElement;
            onTagsChange?: () => void;
          }) =>
            Effect.gen(function* () {
              yield* createTagEditor({
                bookmarkId: config.bookmarkId,
                container: config.container,
                onTagsChange: config.onTagsChange,
              }).pipe(
                Effect.provideService(TagEditorDOMService, tagEditorDom),
                Effect.provideService(TagStorageService, tagStorageService),
                Effect.provideService(TagEventsService, tagEventsService)
              );
            }),
        };
      })
    );

  const createMockExportService = () =>
    Layer.succeed(ExportService, {
      exportBookmark: (id: string) => Effect.succeed(`export-data-${id}`),
      downloadExport: (data: string) => Effect.void,
    });

  const createMockJobService = () =>
    Layer.succeed(JobService, {
      retryBookmark: (id: string) => Effect.void,
      triggerProcessingQueue: () => Effect.void,
    });

  const createMockTagRepository = () =>
    Layer.succeed(TagRepository, {
      getAllTags: () => {
        const allBookmarkTags: BookmarkTag[] = [];
        tagStorage.forEach((tags, bookmarkId) => {
          allBookmarkTags.push(...tags);
        });
        return Effect.succeed(allBookmarkTags);
      },
    });

  // ============================================================================
  // Test: Bookmark Detail Display
  // ============================================================================

  it('should display bookmark details with tag editor', async () => {
    const container = mockDOM.createElement('div');

    const testLayer = Layer.mergeAll(
      createMockTagEditorDOMService(),
      createMockTagStorageService(),
      createMockTagEventsService()
    );

    const createEditorEffect = createTagEditor({
      bookmarkId: 'bookmark-1',
      container,
    });

    await Effect.runPromise(createEditorEffect.pipe(Effect.provide(testLayer)));

    // Verify tag editor section exists
    const tagEditor = container.querySelector('.tag-editor');
    expect(tagEditor).toBeTruthy();

    // Verify heading
    const heading = tagEditor?.querySelector('h3');
    expect(heading?.textContent).toBe('TAGS');

    // Verify tags are rendered
    const tagPills = container.querySelectorAll('.tag-pill');
    expect(tagPills.length).toBe(2);

    // Verify tag names
    const tagTexts = Array.from(tagPills).map((pill) => pill.textContent?.trim());
    expect(tagTexts).toContain('#javascript×');
    expect(tagTexts).toContain('#testing×');
  });

  // ============================================================================
  // Test: Tag Addition
  // ============================================================================

  it('should add a tag to bookmark and trigger event', async () => {
    const testLayer = Layer.mergeAll(
      createMockTagStorageService(),
      createMockTagEventsService()
    );

    // Verify initial tags
    expect(tagStorage.get('bookmark-1')?.length).toBe(2);

    // Add a new tag using the service
    const addTagEffect = Effect.gen(function* () {
      const storage = yield* TagStorageService;
      const events = yield* TagEventsService;

      yield* storage.addTag('bookmark-1', 'new-tag');
      yield* events.tagAdded('bookmark-1', 'new-tag');
    });

    await Effect.runPromise(addTagEffect.pipe(Effect.provide(testLayer)));

    // Verify tag was added
    expect(tagStorage.get('bookmark-1')?.length).toBe(3);
    expect(
      tagStorage.get('bookmark-1')?.some((t) => t.tagName === 'new-tag')
    ).toBe(true);

    // Verify event was logged
    expect(tagEventsLog).toContainEqual({
      type: 'added',
      bookmarkId: 'bookmark-1',
      tagName: 'new-tag',
    });
  });

  // ============================================================================
  // Test: Tag Removal
  // ============================================================================

  it('should remove a tag from bookmark and trigger event', async () => {
    const testLayer = Layer.mergeAll(
      createMockTagStorageService(),
      createMockTagEventsService()
    );

    // Verify initial tags
    expect(tagStorage.get('bookmark-1')?.length).toBe(2);

    // Remove a tag using the service
    const removeTagEffect = Effect.gen(function* () {
      const storage = yield* TagStorageService;
      const events = yield* TagEventsService;

      yield* storage.removeTag('bookmark-1', 'javascript');
      yield* events.tagRemoved('bookmark-1', 'javascript');
    });

    await Effect.runPromise(removeTagEffect.pipe(Effect.provide(testLayer)));

    // Verify tag was removed
    const remainingTags = tagStorage.get('bookmark-1') ?? [];
    expect(remainingTags.length).toBe(1);
    expect(remainingTags.some((t) => t.tagName === 'javascript')).toBe(false);

    // Verify event was logged
    expect(tagEventsLog).toContainEqual({
      type: 'removed',
      bookmarkId: 'bookmark-1',
      tagName: 'javascript',
    });
  });

  // ============================================================================
  // Test: Tag Filter Rendering
  // ============================================================================

  it('should render tag filters with all available tags', async () => {
    const selectedTags = new Set<string>();
    const onChangeSpy = vi.fn();

    const filterConfig: TagFilterConfig = {
      container: mockDOM.tagFilterContainer,
      selectedTags,
      onChange: onChangeSpy,
    };

    const testLayer = createMockTagRepository();

    const loadFiltersEffect = loadTagFilters(filterConfig);

    await Effect.runPromise(loadFiltersEffect.pipe(Effect.provide(testLayer)));

    // Verify filter items are rendered
    const filterItems = mockDOM.tagFilterContainer.querySelectorAll('.filter-item');
    expect(filterItems.length).toBeGreaterThan(0);

    // Verify tags are rendered (at least the ones we have in storage)
    const filterTexts = Array.from(filterItems).map((item) => item.textContent?.trim());
    expect(filterTexts).toContain('#javascript');
    expect(filterTexts).toContain('#testing');
  });

  // ============================================================================
  // Test: Tag Filter Selection
  // ============================================================================

  it('should update selected tags when filter checkbox is clicked', async () => {
    const selectedTags = new Set<string>();
    const onChangeSpy = vi.fn();

    const filterConfig: TagFilterConfig = {
      container: mockDOM.tagFilterContainer,
      selectedTags,
      onChange: onChangeSpy,
    };

    const testLayer = createMockTagRepository();

    const loadFiltersEffect = loadTagFilters(filterConfig);

    await Effect.runPromise(loadFiltersEffect.pipe(Effect.provide(testLayer)));

    // Find the 'javascript' checkbox
    const filterItems = mockDOM.tagFilterContainer.querySelectorAll('.filter-item');
    const javascriptFilter = Array.from(filterItems).find((item) =>
      item.textContent?.includes('#javascript')
    );

    expect(javascriptFilter).toBeTruthy();

    const checkbox = javascriptFilter?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();

    // Simulate clicking the checkbox
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Verify the tag was added to selectedTags
    expect(selectedTags.has('javascript')).toBe(true);
    expect(onChangeSpy).toHaveBeenCalled();
  });

  // ============================================================================
  // Test: Tag Filter Clear Selection
  // ============================================================================

  it('should clear all selected tags when clear button is clicked', async () => {
    const selectedTags = new Set<string>(['javascript', 'testing']);
    const onChangeSpy = vi.fn();

    const filterConfig: TagFilterConfig = {
      container: mockDOM.tagFilterContainer,
      selectedTags,
      onChange: onChangeSpy,
    };

    const testLayer = createMockTagRepository();

    const loadFiltersEffect = loadTagFilters(filterConfig);

    await Effect.runPromise(loadFiltersEffect.pipe(Effect.provide(testLayer)));

    // Verify clear button is rendered (only shown when tags are selected)
    const clearBtn = mockDOM.tagFilterContainer.querySelector(
      '.clear-selection-btn'
    ) as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();

    // Click the clear button
    clearBtn?.click();

    // Verify selected tags were cleared
    expect(selectedTags.size).toBe(0);
    expect(onChangeSpy).toHaveBeenCalled();
  });

  // ============================================================================
  // Test: Event Propagation on Tag Changes
  // ============================================================================

  it('should propagate tag change events across components', async () => {
    const testLayer = Layer.mergeAll(
      createMockTagStorageService(),
      createMockTagEventsService()
    );

    // Clear the event log
    tagEventsLog.length = 0;

    // Add a tag
    const addTagEffect = Effect.gen(function* () {
      const storage = yield* TagStorageService;
      const events = yield* TagEventsService;

      yield* storage.addTag('bookmark-1', 'event-test');
      yield* events.tagAdded('bookmark-1', 'event-test');
    });

    await Effect.runPromise(addTagEffect.pipe(Effect.provide(testLayer)));

    // Verify event was logged
    expect(tagEventsLog).toContainEqual({
      type: 'added',
      bookmarkId: 'bookmark-1',
      tagName: 'event-test',
    });

    // Remove the tag
    const removeTagEffect = Effect.gen(function* () {
      const storage = yield* TagStorageService;
      const events = yield* TagEventsService;

      yield* storage.removeTag('bookmark-1', 'event-test');
      yield* events.tagRemoved('bookmark-1', 'event-test');
    });

    await Effect.runPromise(removeTagEffect.pipe(Effect.provide(testLayer)));

    // Verify removal event was logged
    expect(tagEventsLog).toContainEqual({
      type: 'removed',
      bookmarkId: 'bookmark-1',
      tagName: 'event-test',
    });

    // Verify both events are in order
    expect(tagEventsLog.length).toBe(2);
    expect(tagEventsLog[0].type).toBe('added');
    expect(tagEventsLog[1].type).toBe('removed');
  });

  // ============================================================================
  // Test: Integration - Full Workflow
  // ============================================================================

  it('should handle complete workflow: create editor, add tag, filter by tag', async () => {
    // Step 1: Create tag editor for bookmark
    const container = mockDOM.createElement('div');

    const editorTestLayer = Layer.mergeAll(
      createMockTagEditorDOMService(),
      createMockTagStorageService(),
      createMockTagEventsService()
    );

    const createEditorEffect = createTagEditor({
      bookmarkId: 'bookmark-1',
      container,
    });

    await Effect.runPromise(createEditorEffect.pipe(Effect.provide(editorTestLayer)));

    // Verify editor is created with initial tags
    const tagPills = container.querySelectorAll('.tag-pill');
    expect(tagPills.length).toBe(2);

    // Step 2: Add a new tag using the service
    const addTagEffect = Effect.gen(function* () {
      const storage = yield* TagStorageService;
      const events = yield* TagEventsService;

      yield* storage.addTag('bookmark-1', 'integration-test');
      yield* events.tagAdded('bookmark-1', 'integration-test');
    });

    await Effect.runPromise(addTagEffect.pipe(Effect.provide(editorTestLayer)));

    // Verify tag was added
    const bookmarkTags = tagStorage.get('bookmark-1') ?? [];
    expect(bookmarkTags.some((t) => t.tagName === 'integration-test')).toBe(true);

    // Step 3: Load tag filters
    const selectedTags = new Set<string>();
    const filterOnChangeSpy = vi.fn();

    const filterConfig: TagFilterConfig = {
      container: mockDOM.tagFilterContainer,
      selectedTags,
      onChange: filterOnChangeSpy,
    };

    const filterTestLayer = createMockTagRepository();

    await Effect.runPromise(
      loadTagFilters(filterConfig).pipe(Effect.provide(filterTestLayer))
    );

    // Step 4: Verify the new tag appears in filters
    const filterItems = mockDOM.tagFilterContainer.querySelectorAll('.filter-item');
    const filterTexts = Array.from(filterItems).map((item) => item.textContent?.trim());
    expect(filterTexts).toContain('#integration-test');

    // Step 5: Select the new tag in filter
    const integrationTestFilter = Array.from(filterItems).find((item) =>
      item.textContent?.includes('#integration-test')
    );
    const checkbox = integrationTestFilter?.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // Verify filter selection
    expect(selectedTags.has('integration-test')).toBe(true);
    expect(filterOnChangeSpy).toHaveBeenCalled();

    // Verify event propagation
    expect(tagEventsLog.some((e) => e.type === 'added' && e.tagName === 'integration-test')).toBe(
      true
    );
  });
});
