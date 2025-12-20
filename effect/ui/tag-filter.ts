import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Data } from 'effect';
import type { BookmarkTag } from '../db/schema';
import { RepositoryError } from '../lib/errors';

export interface TagFilterConfig {
  readonly container: HTMLElement;
  readonly selectedTags: Set<string>;
  readonly onChange: () => void;
}

export class UIError extends Data.TaggedError('UIError')<{
  readonly code: 'ELEMENT_NOT_FOUND' | 'RENDER_FAILED' | 'EVENT_HANDLER_FAILED';
  readonly component: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

export class TagRepository extends Context.Tag('TagRepository')<
  TagRepository,
  {
    readonly getAllTags: () => Effect.Effect<BookmarkTag[], RepositoryError, never>;
  }
>() {}

export interface CreateElementOptions {
  readonly className?: string;
  readonly textContent?: string;
  readonly attributes?: Record<string, string>;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: CreateElementOptions
): Effect.Effect<HTMLElementTagNameMap[K], never, never> {
  return Effect.sync(() => {
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

    return el;
  });
}

function extractUniqueTagNames(
  bookmarkTags: readonly BookmarkTag[]
): Effect.Effect<readonly string[], never, never> {
  return Effect.sync(() => {
    const tagSet = new Set<string>(bookmarkTags.map((t) => t.tagName));
    return Array.from(tagSet).sort();
  });
}

function createClearButton(
  config: TagFilterConfig
): Effect.Effect<HTMLButtonElement, never, never> {
  return Effect.gen(function* () {
    const btn = yield* createElement('button', {
      className: 'clear-selection-btn',
      textContent: 'Clear selection',
    });

    yield* Effect.sync(() => {
      btn.onclick = () => {
        config.selectedTags.clear();
        config.onChange();
      };
    });

    return btn;
  });
}

function createTagFilterCheckbox(
  tag: string,
  config: TagFilterConfig
): Effect.Effect<HTMLLabelElement, never, never> {
  return Effect.gen(function* () {
    const label = yield* createElement('label', { className: 'filter-item' });
    const checkbox = yield* createElement('input', {
      attributes: { type: 'checkbox' },
    });
    const span = yield* createElement('span', { textContent: `#${tag}` });

    yield* Effect.sync(() => {
      checkbox.checked = config.selectedTags.has(tag);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          config.selectedTags.add(tag);
        } else {
          config.selectedTags.delete(tag);
        }
        config.onChange();
      };

      label.appendChild(checkbox);
      label.appendChild(span);
    });

    return label;
  });
}

function createTagFilterElements(
  tags: readonly string[],
  config: TagFilterConfig
): Effect.Effect<readonly HTMLElement[], never, never> {
  return Effect.gen(function* () {
    const elements: HTMLElement[] = [];

    if (config.selectedTags.size > 0) {
      const clearBtn = yield* createClearButton(config);
      elements.push(clearBtn);
    }

    for (const tag of tags) {
      const checkbox = yield* createTagFilterCheckbox(tag, config);
      elements.push(checkbox);
    }

    return elements;
  });
}

function renderToContainer(
  container: HTMLElement,
  elements: readonly HTMLElement[]
): Effect.Effect<void, UIError, never> {
  return Effect.try({
    try: () => {
      const fragment = document.createDocumentFragment();
      for (const element of elements) {
        fragment.appendChild(element);
      }

      container.innerHTML = '';
      container.appendChild(fragment);
    },
    catch: (error) =>
      new UIError({
        code: 'RENDER_FAILED',
        component: 'tag-filter',
        message: 'Failed to render tag filters to container',
        originalError: error,
      }),
  });
}

export function loadTagFilters(
  config: TagFilterConfig
): Effect.Effect<void, RepositoryError | UIError, TagRepository> {
  return Effect.gen(function* () {
    const tagRepository = yield* TagRepository;

    const allBookmarkTags = yield* tagRepository.getAllTags();

    const uniqueTags = yield* extractUniqueTagNames(allBookmarkTags);

    const filterElements = yield* createTagFilterElements(uniqueTags, config);

    yield* renderToContainer(config.container, filterElements);
  });
}

export const TagRepositoryLive = (
  getAllTagsFn: () => Promise<BookmarkTag[]>
): Layer.Layer<TagRepository, never, never> =>
  Layer.succeed(TagRepository, {
    getAllTags: () =>
      Effect.tryPromise({
        try: getAllTagsFn,
        catch: (error) =>
          new RepositoryError({
            code: 'UNKNOWN',
            entity: 'bookmarkTags',
            operation: 'query',
            message: 'Failed to load bookmark tags',
            originalError: error,
          }),
      }),
  });

export function runLoadTagFilters(
  config: TagFilterConfig,
  getAllTagsFn: () => Promise<BookmarkTag[]>
): Promise<void> {
  const layer = TagRepositoryLive(getAllTagsFn);

  return Effect.runPromise(
    loadTagFilters(config).pipe(Effect.provide(layer))
  );
}
