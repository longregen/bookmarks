import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { makeLayer, makeEffectLayer } from '../../lib/effect-utils';
import {
  ConfigError,
  ValidationError,
  getErrorMessage,
} from '../lib/errors';
import {
  ConfigService,
  type ConfigEntryWithMetadata,
  CONFIG_CATEGORIES,
} from '../lib/config-registry';
import { createElement, getElement } from '../../src/ui/dom';

export class DOMError extends Data.TaggedError('DOMError')<{
  readonly code: 'ELEMENT_NOT_FOUND' | 'INVALID_SELECTOR' | 'DOM_MANIPULATION_FAILED';
  readonly selector?: string;
  readonly message: string;
  readonly originalError?: unknown;
}> {}

/**
 * Service for DOM manipulation and event handling
 */
export class DOMService extends Context.Tag('DOMService')<
  DOMService,
  {
    readonly getElementById: <T extends HTMLElement>(
      id: string
    ) => Effect.Effect<T, DOMError, never>;

    readonly querySelector: <T extends HTMLElement>(
      selector: string
    ) => Effect.Effect<T | null, never, never>;

    readonly addEventListener: <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      event: K,
      handler: (event: HTMLElementEventMap[K]) => void | Promise<void>
    ) => Effect.Effect<void, never, never>;

    readonly clearChildren: (
      element: HTMLElement
    ) => Effect.Effect<void, never, never>;

    readonly appendChild: (
      parent: HTMLElement,
      child: Node
    ) => Effect.Effect<void, never, never>;

    readonly replaceChildren: (
      parent: HTMLElement
    ) => Effect.Effect<void, never, never>;

    readonly focus: (element: HTMLElement) => Effect.Effect<void, never, never>;

    readonly select: (
      element: HTMLInputElement
    ) => Effect.Effect<void, never, never>;

    readonly confirm: (message: string) => Effect.Effect<boolean, never, never>;
  }
>() {}

/**
 * Service for showing status notifications
 */
export class StatusNotificationService extends Context.Tag('StatusNotificationService')<
  StatusNotificationService,
  {
    readonly showStatus: (
      message: string,
      type: 'success' | 'error'
    ) => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Service for managing UI state
 */
export class UIStateService extends Context.Tag('UIStateService')<
  UIStateService,
  {
    readonly getEditingKey: () => Effect.Effect<string | null, never, never>;
    readonly setEditingKey: (key: string | null) => Effect.Effect<void, never, never>;
    readonly getSearchQuery: () => Effect.Effect<string, never, never>;
    readonly getCategoryFilter: () => Effect.Effect<string, never, never>;
    readonly getShowModifiedOnly: () => Effect.Effect<boolean, never, never>;
  }
>() {}

interface AdvancedConfigState {
  searchInput: HTMLInputElement;
  categoryFilter: HTMLSelectElement;
  showModifiedOnly: HTMLInputElement;
  configTableBody: HTMLTableSectionElement;
  resetAllBtn: HTMLButtonElement;
  modifiedCountSpan: HTMLElement | null;
  editingKey: string | null;
}

let state: AdvancedConfigState | null = null;

/**
 * Production layer for DOMService
 */
export const DOMServiceLive: Layer.Layer<DOMService, never, never> = makeLayer(
  DOMService,
  {
    getElementById: <T extends HTMLElement>(id: string) =>
      Effect.sync(() => {
        try {
          return getElement<T>(id);
        } catch (error) {
          throw new DOMError({
            code: 'ELEMENT_NOT_FOUND',
            selector: id,
            message: `Element with id "${id}" not found`,
            originalError: error,
          });
        }
      }),

    querySelector: <T extends HTMLElement>(selector: string) =>
      Effect.sync(() => document.querySelector<T>(selector)),

    addEventListener: (element, event, handler) =>
      Effect.sync(() => {
        element.addEventListener(event, handler as EventListener);
      }),

    clearChildren: (element) =>
      Effect.sync(() => {
        element.replaceChildren();
      }),

    appendChild: (parent, child) =>
      Effect.sync(() => {
        parent.appendChild(child);
      }),

    replaceChildren: (parent) =>
      Effect.sync(() => {
        parent.replaceChildren();
      }),

    focus: (element) =>
      Effect.sync(() => {
        element.focus();
      }),

    select: (element) =>
      Effect.sync(() => {
        element.select();
      }),

    confirm: (message) =>
      Effect.sync(() => confirm(message)),
  }
);

/**
 * Production layer for StatusNotificationService
 */
export const StatusNotificationServiceLive: Layer.Layer<
  StatusNotificationService,
  never,
  never
> = makeLayer(StatusNotificationService, {
  showStatus: (message, type) =>
    Effect.sync(() => {
      const status = document.getElementById('configStatus');
      if (!status) return;

      status.textContent = message;
      status.className = `config-status ${type}`;
      status.classList.remove('hidden');

      setTimeout(() => {
        status.classList.add('hidden');
      }, 3000);
    }),
});

/**
 * Production layer for UIStateService
 */
export const UIStateServiceLive: Layer.Layer<UIStateService, never, never> =
  makeLayer(UIStateService, {
    getEditingKey: () =>
      Effect.sync(() => (state ? state.editingKey : null)),

    setEditingKey: (key) =>
      Effect.sync(() => {
        if (state) {
          state.editingKey = key;
        }
      }),

    getSearchQuery: () =>
      Effect.sync(() => (state ? state.searchInput.value.trim() : '')),

    getCategoryFilter: () =>
      Effect.sync(() => (state ? state.categoryFilter.value : '')),

    getShowModifiedOnly: () =>
      Effect.sync(() => (state ? state.showModifiedOnly.checked : false)),
  });

/**
 * Combined layer with all dependencies
 */
export const AdvancedConfigPageLayer: Layer.Layer<
  DOMService | StatusNotificationService | UIStateService,
  never,
  never
> = Layer.mergeAll(
  DOMServiceLive,
  StatusNotificationServiceLive,
  UIStateServiceLive
);

/**
 * Initialize the advanced config module
 */
export function initAdvancedConfigModule(): Effect.Effect<
  void,
  ConfigError | DOMError,
  ConfigService | DOMService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const dom = yield* DOMService;

    yield* configService.ensureLoaded;

    const searchInput = yield* dom.getElementById<HTMLInputElement>('configSearch');
    const categoryFilter = yield* dom.getElementById<HTMLSelectElement>('configCategoryFilter');
    const showModifiedOnly = yield* dom.getElementById<HTMLInputElement>('showModifiedOnly');
    const configTableBody = yield* dom.getElementById<HTMLTableSectionElement>('configTableBody');
    const resetAllBtn = yield* dom.getElementById<HTMLButtonElement>('resetAllConfig');
    const modifiedCountSpan = yield* Effect.sync(() => document.getElementById('modifiedConfigCount'));

    state = {
      searchInput,
      categoryFilter,
      showModifiedOnly,
      configTableBody,
      resetAllBtn,
      modifiedCountSpan,
      editingKey: null,
    };

    yield* populateCategoryFilter();
    yield* setupEventListeners();
    yield* renderConfigTable();
    yield* updateModifiedCount();
  });
}

/**
 * Populate the category filter dropdown
 */
function populateCategoryFilter(): Effect.Effect<
  void,
  never,
  DOMService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;

    if (!state) return;

    const allOption = createElement('option', {
      textContent: 'All Categories',
      attributes: { value: '' },
    });
    yield* dom.appendChild(state.categoryFilter, allOption);

    for (const category of Object.values(CONFIG_CATEGORIES)) {
      const option = createElement('option', {
        textContent: category,
        attributes: { value: category },
      });
      yield* dom.appendChild(state.categoryFilter, option);
    }
  });
}

/**
 * Set up event listeners for the UI
 */
function setupEventListeners(): Effect.Effect<
  void,
  never,
  DOMService | ConfigService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;
    const configService = yield* ConfigService;

    if (!state) return;

    yield* dom.addEventListener(state.searchInput, 'input', () => {
      void Effect.runPromise(
        renderConfigTable().pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });

    yield* dom.addEventListener(state.categoryFilter, 'change', () => {
      void Effect.runPromise(
        renderConfigTable().pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });

    yield* dom.addEventListener(state.showModifiedOnly, 'change', () => {
      void Effect.runPromise(
        renderConfigTable().pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });

    yield* dom.addEventListener(state.resetAllBtn, 'click', async () => {
      await Effect.runPromise(
        handleResetAll().pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });

    yield* dom.addEventListener(state.configTableBody, 'click', async (event) => {
      await Effect.runPromise(
        handleTableClick(event as MouseEvent).pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });

    yield* dom.addEventListener(state.configTableBody, 'keydown', async (event) => {
      await Effect.runPromise(
        handleTableKeydown(event as KeyboardEvent).pipe(
          Effect.provide(AdvancedConfigPageLayer),
          Effect.provideService(ConfigService, configService)
        )
      );
    });
  });
}

/**
 * Get filtered config entries based on current UI state
 */
function getFilteredEntries(): Effect.Effect<
  ConfigEntryWithMetadata[],
  ConfigError,
  ConfigService | UIStateService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const uiState = yield* UIStateService;

    const query = yield* uiState.getSearchQuery();
    const category = yield* uiState.getCategoryFilter();
    const modifiedOnly = yield* uiState.getShowModifiedOnly();

    let entries = query
      ? yield* configService.searchEntries(query)
      : yield* configService.getAllEntries;

    if (category) {
      entries = entries.filter((e) => e.category === category);
    }

    if (modifiedOnly) {
      entries = entries.filter((e) => e.isModified);
    }

    return entries;
  });
}

/**
 * Render the config table
 */
function renderConfigTable(): Effect.Effect<
  void,
  ConfigError,
  ConfigService | DOMService | UIStateService
> {
  return Effect.gen(function* () {
    const dom = yield* DOMService;
    const uiState = yield* UIStateService;

    if (!state) return;

    const entries = yield* getFilteredEntries();
    const fragment = document.createDocumentFragment();

    if (entries.length === 0) {
      const emptyRow = createElement('tr', {}, [
        createElement('td', {
          className: 'config-empty',
          textContent: 'No configuration entries found matching your criteria.',
          attributes: { colspan: '5' },
        }),
      ]);
      fragment.appendChild(emptyRow);
    } else {
      const editingKey = yield* uiState.getEditingKey();
      for (const entry of entries) {
        const [mainRow, descRow] = renderConfigRow(entry, editingKey);
        fragment.appendChild(mainRow);
        fragment.appendChild(descRow);
      }
    }

    yield* dom.clearChildren(state.configTableBody);
    yield* dom.appendChild(state.configTableBody, fragment);
  });
}

/**
 * Render a single config row
 */
function renderConfigRow(
  entry: ConfigEntryWithMetadata,
  editingKey: string | null
): [HTMLTableRowElement, HTMLTableRowElement] {
  const isEditing = editingKey === entry.key;
  const modifiedClass = entry.isModified ? 'config-modified' : '';

  const keyCell = createElement('td', { className: 'config-key' }, [
    createElement('span', { className: 'key-name', textContent: entry.key }),
    createElement('span', { className: 'key-category', textContent: entry.category }),
  ]);

  const typeCell = createElement('td', { className: 'config-type', textContent: entry.type });

  const valueCell = createElement('td', {
    className: 'config-value',
    attributes: { 'data-key': entry.key },
  });
  if (isEditing) {
    renderEditInput(entry, valueCell);
  } else {
    valueCell.appendChild(renderValueDisplay(entry));
  }

  const defaultCell = createElement('td', {
    className: 'config-default',
    title: `Default: ${entry.defaultValue}`,
  });
  defaultCell.appendChild(formatValue(entry.defaultValue, entry.type));

  const actionsCell = createElement('td', { className: 'config-actions' });
  if (entry.isModified) {
    const resetBtn = createElement('button', {
      className: 'btn-reset',
      textContent: 'Reset',
      title: 'Reset to default',
      attributes: { 'data-key': entry.key },
    });
    actionsCell.appendChild(resetBtn);
  }

  const mainRow = createElement(
    'tr',
    {
      className: `config-row ${modifiedClass}`.trim(),
      attributes: { 'data-key': entry.key },
    },
    [keyCell, typeCell, valueCell, defaultCell, actionsCell]
  );

  const descRow = createElement(
    'tr',
    { className: `config-description-row ${modifiedClass}`.trim() },
    [
      createElement('td', {
        className: 'config-description',
        textContent: entry.description,
        attributes: { colspan: '5' },
      }),
    ]
  );

  return [mainRow, descRow];
}

/**
 * Render the value display element
 */
function renderValueDisplay(
  entry: ConfigEntryWithMetadata
): HTMLElement {
  const valueSpan = createElement('span', {
    className: 'value-display',
    attributes: {
      'data-key': entry.key,
      tabindex: '0',
      role: 'button',
      'aria-label': `Click to edit ${entry.key}`,
    },
  });
  valueSpan.appendChild(formatValue(entry.currentValue, entry.type));
  return valueSpan;
}

/**
 * Render the edit input element
 */
function renderEditInput(
  entry: ConfigEntryWithMetadata,
  container: HTMLElement
): void {
  if (entry.type === 'boolean') {
    const select = createElement(
      'select',
      {
        className: 'config-edit-select',
        attributes: { 'data-key': entry.key, autofocus: '' },
      },
      [
        createElement('option', {
          textContent: 'true',
          attributes:
            entry.currentValue === true
              ? { value: 'true', selected: '' }
              : { value: 'true' },
        }),
        createElement('option', {
          textContent: 'false',
          attributes:
            entry.currentValue === false
              ? { value: 'false', selected: '' }
              : { value: 'false' },
        }),
      ]
    );
    container.appendChild(select);
  } else if (entry.type === 'textarea') {
    const textarea = createElement('textarea', {
      className: 'config-edit-textarea',
      textContent: String(entry.currentValue),
      attributes: {
        'data-key': entry.key,
        autofocus: '',
        rows: '8',
        spellcheck: 'false',
      },
    });
    container.appendChild(textarea);
  } else {
    const inputType = entry.type === 'number' ? 'number' : 'text';
    const attrs: Record<string, string> = {
      type: inputType,
      'data-key': entry.key,
      value: String(entry.currentValue),
      autofocus: '',
    };

    if (entry.type === 'number' && entry.key.includes('TEMPERATURE')) {
      attrs.step = '0.1';
    }
    if (entry.min !== undefined) attrs.min = String(entry.min);
    if (entry.max !== undefined) attrs.max = String(entry.max);

    const input = createElement('input', {
      className: 'config-edit-input',
      attributes: attrs,
    });
    container.appendChild(input);
  }

  container.appendChild(
    createElement('button', {
      className: 'btn-save',
      textContent: 'Save',
      attributes: { 'data-key': entry.key },
    })
  );

  container.appendChild(
    createElement('button', {
      className: 'btn-cancel',
      textContent: 'Cancel',
      attributes: { 'data-key': entry.key },
    })
  );
}

/**
 * Format a value for display
 */
function formatValue(value: number | string | boolean, type: string): HTMLElement {
  if (type === 'boolean') {
    return createElement('span', {
      className: 'value-boolean',
      textContent: String(value),
    });
  }
  if (type === 'number') {
    const formatted = typeof value === 'number' ? value.toLocaleString() : String(value);
    return createElement('span', { className: 'value-number', textContent: formatted });
  }
  if (type === 'textarea') {
    const strValue = String(value);
    const truncated = strValue.length > 50 ? `${strValue.slice(0, 50)}...` : strValue;
    const firstLine = truncated.split('\n')[0];
    return createElement('span', {
      className: 'value-textarea',
      textContent: `"${firstLine}"`,
    });
  }
  return createElement('span', { className: 'value-string', textContent: `"${value}"` });
}

/**
 * Handle table click events
 */
function handleTableClick(event: MouseEvent): Effect.Effect<
  void,
  ConfigError | ValidationError,
  ConfigService | DOMService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const target = event.target as HTMLElement;

    if (target.classList.contains('value-display')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* startEditing(key);
      }
      return;
    }

    if (target.classList.contains('btn-save')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* saveEdit(key);
      }
      return;
    }

    if (target.classList.contains('btn-cancel')) {
      yield* cancelEditing();
      return;
    }

    if (target.classList.contains('btn-reset')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* resetValue(key);
      }
      return;
    }
  });
}

/**
 * Handle table keydown events
 */
function handleTableKeydown(event: KeyboardEvent): Effect.Effect<
  void,
  ConfigError | ValidationError,
  ConfigService | DOMService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const target = event.target as HTMLElement;

    if (target.classList.contains('value-display') && event.key === 'Enter') {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* startEditing(key);
      }
      return;
    }

    if (
      target.classList.contains('config-edit-textarea') &&
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* saveEdit(key);
      }
      return;
    }

    if (
      (target.classList.contains('config-edit-input') ||
        target.classList.contains('config-edit-select')) &&
      event.key === 'Enter'
    ) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* saveEdit(key);
      }
      return;
    }

    if (
      (target.classList.contains('config-edit-input') ||
        target.classList.contains('config-edit-select') ||
        target.classList.contains('config-edit-textarea')) &&
      event.key === 'Escape'
    ) {
      yield* cancelEditing();
      return;
    }
  });
}

/**
 * Start editing a config value
 */
function startEditing(key: string): Effect.Effect<
  void,
  ConfigError,
  ConfigService | DOMService | UIStateService
> {
  return Effect.gen(function* () {
    const uiState = yield* UIStateService;
    const dom = yield* DOMService;

    yield* uiState.setEditingKey(key);
    yield* renderConfigTable();

    const input = yield* dom.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"], .config-edit-textarea[data-key="${key}"]`
    );

    if (input) {
      yield* dom.focus(input);
      if (input instanceof HTMLInputElement) {
        yield* dom.select(input);
      } else if (input instanceof HTMLTextAreaElement) {
        yield* Effect.sync(() => {
          input.setSelectionRange(0, 0);
        });
      }
    }
  });
}

/**
 * Cancel editing
 */
function cancelEditing(): Effect.Effect<
  void,
  ConfigError,
  ConfigService | DOMService | UIStateService
> {
  return Effect.gen(function* () {
    const uiState = yield* UIStateService;
    yield* uiState.setEditingKey(null);
    yield* renderConfigTable();
  });
}

/**
 * Save edited value
 */
function saveEdit(key: string): Effect.Effect<
  void,
  ConfigError | ValidationError,
  ConfigService | DOMService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const dom = yield* DOMService;
    const status = yield* StatusNotificationService;
    const uiState = yield* UIStateService;

    const allEntries = yield* configService.getAllEntries;
    const entry = allEntries.find((e) => e.key === key);

    if (!entry) {
      yield* status.showStatus(`Configuration entry not found: ${key}`, 'error');
      return;
    }

    const input = yield* dom.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"], .config-edit-textarea[data-key="${key}"]`
    );

    if (!input) {
      yield* status.showStatus('Input element not found', 'error');
      return;
    }

    const parseResult = yield* Effect.try({
      try: () => {
        let newValue: number | string | boolean;

        if (entry.type === 'boolean') {
          newValue = (input as HTMLSelectElement).value === 'true';
        } else if (entry.type === 'number') {
          newValue = parseFloat((input as HTMLInputElement).value);
          if (isNaN(newValue)) {
            throw new Error('Invalid number');
          }
        } else if (entry.type === 'textarea') {
          newValue = (input as HTMLTextAreaElement).value;
        } else {
          newValue = (input as HTMLInputElement).value;
        }

        return newValue;
      },
      catch: (error) =>
        new ValidationError({
          field: key,
          reason: 'Invalid value format',
          message: getErrorMessage(error),
        }),
    });

    yield* configService.setValue(key, parseResult);
    yield* uiState.setEditingKey(null);
    yield* renderConfigTable();
    yield* updateModifiedCount();
    yield* status.showStatus(`Updated ${key}`, 'success');
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const status = yield* StatusNotificationService;
        yield* status.showStatus(getErrorMessage(error), 'error');
      })
    )
  );
}

/**
 * Reset a value to default
 */
function resetValue(key: string): Effect.Effect<
  void,
  ConfigError,
  ConfigService | StatusNotificationService | DOMService | UIStateService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const status = yield* StatusNotificationService;

    yield* configService.resetValue(key);
    yield* renderConfigTable();
    yield* updateModifiedCount();
    yield* status.showStatus(`Reset ${key} to default`, 'success');
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const status = yield* StatusNotificationService;
        yield* status.showStatus(getErrorMessage(error), 'error');
      })
    )
  );
}

/**
 * Handle reset all button click
 */
function handleResetAll(): Effect.Effect<
  void,
  ConfigError,
  ConfigService | DOMService | StatusNotificationService | UIStateService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const dom = yield* DOMService;
    const status = yield* StatusNotificationService;

    const modifiedCount = yield* configService.getModifiedCount;

    if (modifiedCount === 0) {
      return;
    }

    const confirmed = yield* dom.confirm(
      'Are you sure you want to reset all modified settings to their default values?\n\n' +
        'This action cannot be undone.'
    );

    if (!confirmed) {
      return;
    }

    yield* configService.resetAll;
    yield* renderConfigTable();
    yield* updateModifiedCount();
    yield* status.showStatus('All settings have been reset to defaults.', 'success');
  });
}

/**
 * Update the modified count display
 */
function updateModifiedCount(): Effect.Effect<
  void,
  ConfigError,
  ConfigService
> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;

    if (!state) return;

    const count = yield* configService.getModifiedCount;

    if (state.modifiedCountSpan) {
      state.modifiedCountSpan.textContent = count.toString();
      state.modifiedCountSpan.parentElement?.classList.toggle('hidden', count === 0);
    }

    state.resetAllBtn.disabled = count === 0;
  });
}

/**
 * Run the initialization with proper layers
 */
export async function runInitAdvancedConfigModule(
  configServiceLayer: Layer.Layer<ConfigService, never, never>
): Promise<void> {
  const program = initAdvancedConfigModule().pipe(
    Effect.provide(AdvancedConfigPageLayer),
    Effect.provide(configServiceLayer),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error('Failed to initialize advanced config module:', getErrorMessage(error));
      })
    )
  );

  await Effect.runPromise(program);
}
