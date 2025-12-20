import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Data from 'effect/Data';
import { type BookmarkTag } from '../../src/db/schema';

export interface TagEditorOptions {
  bookmarkId: string;
  container: HTMLElement;
  onTagsChange?: () => void;
}

export class TagEditorError extends Data.TaggedError('TagEditorError')<{
  operation: 'create' | 'add' | 'remove' | 'query';
  bookmarkId?: string;
  tagName?: string;
  message: string;
  cause?: unknown;
}> {}

export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly createElement: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: {
        className?: string;
        textContent?: string;
        attributes?: Record<string, string>;
        style?: Partial<CSSStyleDeclaration>;
      }
    ) => Effect.Effect<HTMLElementTagNameMap[K], never, never>;
    readonly createDocumentFragment: () => Effect.Effect<DocumentFragment, never, never>;
  }
>() {}

export class TagStorageService extends Context.Tag('TagStorageService')<
  TagStorageService,
  {
    readonly getTagsForBookmark: (bookmarkId: string) => Effect.Effect<BookmarkTag[], TagEditorError, never>;
    readonly getAllTags: () => Effect.Effect<string[], TagEditorError, never>;
    readonly addTag: (bookmarkId: string, tagName: string) => Effect.Effect<void, TagEditorError, never>;
    readonly removeTag: (bookmarkId: string, tagName: string) => Effect.Effect<void, TagEditorError, never>;
    readonly tagExists: (bookmarkId: string, tagName: string) => Effect.Effect<boolean, TagEditorError, never>;
  }
>() {}

export class TagEventsService extends Context.Tag('TagEventsService')<
  TagEventsService,
  {
    readonly tagAdded: (bookmarkId: string, tagName: string) => Effect.Effect<void, never, never>;
    readonly tagRemoved: (bookmarkId: string, tagName: string) => Effect.Effect<void, never, never>;
  }
>() {}

function normalizeTagName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

function createTagPill(
  tagName: string,
  bookmarkId: string,
  onTagsChange?: () => void
): Effect.Effect<HTMLElement, TagEditorError, DOMService | TagStorageService | TagEventsService> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;
    const storage = yield* TagStorageService;
    const events = yield* TagEventsService;

    const pill = yield* dom.createElement('span', { className: 'tag-pill' });
    const label = yield* dom.createElement('span', { textContent: `#${tagName}` });
    const removeBtn = yield* dom.createElement('button', { textContent: '×' });

    const handleRemove = (): void => {
      const removeEffect = Effect.gen(function* () {
        yield* storage.removeTag(bookmarkId, tagName);
        yield* Effect.sync(() => pill.remove());
        if (onTagsChange) {
          yield* Effect.sync(() => onTagsChange());
        }
        yield* events.tagRemoved(bookmarkId, tagName);
      });

      Effect.runPromise(removeEffect).catch(error => {
        console.error('Failed to remove tag:', error);
      });
    };

    yield* Effect.sync(() => {
      removeBtn.addEventListener('click', handleRemove);
      pill.appendChild(label);
      pill.appendChild(removeBtn);
    });

    return pill;
  });
}

function addTag(
  tagName: string,
  bookmarkId: string,
  container: HTMLElement,
  onTagsChange?: () => void
): Effect.Effect<void, TagEditorError, TagStorageService | TagEventsService | DOMService> {
  return Effect.gen(function* () {
    const storage = yield* TagStorageService;
    const events = yield* TagEventsService;

    const exists = yield* storage.tagExists(bookmarkId, tagName);

    if (!exists) {
      yield* storage.addTag(bookmarkId, tagName);
      yield* events.tagAdded(bookmarkId, tagName);
    }

    yield* createTagEditor({ bookmarkId, container, onTagsChange });
  });
}

function createDropdownContent(
  allTags: string[],
  existingTagNames: string[],
  value: string,
  bookmarkId: string,
  container: HTMLElement,
  onTagsChange?: () => void
): Effect.Effect<DocumentFragment, TagEditorError, DOMService | TagStorageService | TagEventsService> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;

    const matches = allTags
      .filter(t => t.includes(value) && !existingTagNames.includes(t))
      .slice(0, 5);

    const fragment = yield* dom.createDocumentFragment();

    for (const match of matches) {
      const item = yield* dom.createElement('div', {
        textContent: `#${match}`,
        className: 'tag-dropdown-item'
      });

      const handleClick = (): void => {
        const normalized = normalizeTagName(match);
        const addEffect = addTag(normalized, bookmarkId, container, onTagsChange);
        Effect.runPromise(addEffect).catch(error => {
          console.error('Failed to add tag:', error);
        });
      };

      yield* Effect.sync(() => {
        item.addEventListener('click', handleClick);
        fragment.appendChild(item);
      });
    }

    const normalizedValue = normalizeTagName(value);
    if (!allTags.includes(normalizedValue)) {
      const createItem = yield* dom.createElement('div', {
        textContent: `Create "#${normalizedValue}"`,
        className: 'tag-dropdown-item create'
      });

      const handleCreateClick = (): void => {
        const addEffect = addTag(normalizedValue, bookmarkId, container, onTagsChange);
        Effect.runPromise(addEffect).catch(error => {
          console.error('Failed to add tag:', error);
        });
      };

      yield* Effect.sync(() => {
        if (matches.length > 0) {
          createItem.style.borderTop = '1px solid var(--border-primary)';
        }
        createItem.style.color = 'var(--accent-link)';
        createItem.addEventListener('click', handleCreateClick);
        fragment.appendChild(createItem);
      });
    }

    return fragment;
  });
}

export function createTagEditor(
  options: TagEditorOptions
): Effect.Effect<void, TagEditorError, DOMService | TagStorageService | TagEventsService> {
  return Effect.gen(function* () {
    const { bookmarkId, container, onTagsChange } = options;
    const dom = yield* DOMService;
    const storage = yield* TagStorageService;

    const containerWithCleanup = container as HTMLElement & { _cleanup?: () => void };
    if (containerWithCleanup._cleanup) {
      yield* Effect.sync(() => containerWithCleanup._cleanup?.());
    }

    const tags = yield* storage.getTagsForBookmark(bookmarkId);
    const allTags = yield* storage.getAllTags();

    yield* Effect.sync(() => {
      container.innerHTML = '';
    });

    const section = yield* dom.createElement('div', { className: 'tag-editor' });
    const heading = yield* dom.createElement('h3', { textContent: 'TAGS' });
    const tagsContainer = yield* dom.createElement('div', { className: 'tag-editor-tags' });

    for (const tag of tags) {
      const pill = yield* createTagPill(tag.tagName, bookmarkId, onTagsChange);
      yield* Effect.sync(() => tagsContainer.appendChild(pill));
    }

    yield* Effect.sync(() => {
      section.appendChild(heading);
      section.appendChild(tagsContainer);
    });

    const inputWrapper = yield* dom.createElement('div', {
      style: { position: 'relative' } as Partial<CSSStyleDeclaration>
    });

    const input = yield* dom.createElement('input', {
      attributes: { type: 'text', placeholder: 'Type to add tag...' },
      className: 'input'
    });

    const dropdown = yield* dom.createElement('div', {
      className: 'tag-dropdown'
    });

    const existingTagNames = tags.map(t => t.tagName);

    const handleInput = (): void => {
      const inputElement = input as HTMLInputElement;
      const value = inputElement.value.trim().toLowerCase();

      if (!value) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
      }

      const dropdownEffect = Effect.gen(function* () {
        const fragment = yield* createDropdownContent(
          allTags,
          existingTagNames,
          value,
          bookmarkId,
          container,
          onTagsChange
        );

        yield* Effect.sync(() => {
          dropdown.innerHTML = '';
          dropdown.appendChild(fragment);
          dropdown.style.display = fragment.childElementCount > 0 ? 'block' : 'none';
        });
      });

      Effect.runPromise(dropdownEffect).catch(error => {
        console.error('Failed to update dropdown:', error);
      });
    };

    const handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const inputElement = input as HTMLInputElement;
        const value = normalizeTagName(inputElement.value);
        if (value) {
          const addEffect = addTag(value, bookmarkId, container, onTagsChange);
          Effect.runPromise(addEffect).catch(error => {
            console.error('Failed to add tag on Enter:', error);
          });
        }
      }
    };

    const handleClickOutside = (e: MouseEvent): void => {
      if (!inputWrapper.contains(e.target as Node)) {
        dropdown.style.display = 'none';
      }
    };

    yield* Effect.sync(() => {
      input.addEventListener('input', handleInput);
      input.addEventListener('keydown', handleKeydown);
      document.addEventListener('click', handleClickOutside);
    });

    const cleanup = (): void => {
      input.removeEventListener('input', handleInput);
      input.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('click', handleClickOutside);
    };

    yield* Effect.sync(() => {
      containerWithCleanup._cleanup = cleanup;
      inputWrapper.appendChild(input);
      inputWrapper.appendChild(dropdown);
      section.appendChild(inputWrapper);
      container.appendChild(section);
    });
  });
}

export function createTagEditorWithRuntime(
  options: TagEditorOptions,
  runtime: {
    dom: DOMService;
    storage: TagStorageService;
    events: TagEventsService;
  }
): Promise<void> {
  const effect = createTagEditor(options);

  return Effect.runPromise(
    Effect.provideService(
      Effect.provideService(
        Effect.provideService(effect, DOMService, runtime.dom),
        TagStorageService,
        runtime.storage
      ),
      TagEventsService,
      runtime.events
    )
  );
}
