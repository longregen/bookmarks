import * as Effect from 'effect/Effect';
import * as Ref from 'effect/Ref';
import { ConfigService, CONFIG_CATEGORIES, type ConfigEntryWithMetadata } from '../../lib/config-registry';
import { getErrorMessage } from '../../lib/errors';
import { DOMError, UIService, UIServiceLive } from '../shared';
import { createElement, getElementSafe, clearChildren } from '../shared/dom-helpers';

interface ModuleState {
  editingKey: string | null;
}

interface DOMRefs {
  searchInput: HTMLInputElement;
  categoryFilter: HTMLSelectElement;
  showModifiedOnly: HTMLInputElement;
  configTableBody: HTMLTableSectionElement;
  resetAllBtn: HTMLButtonElement;
  modifiedCountSpan: HTMLElement | null;
  statusElement: HTMLElement | null;
}

function getDOMRefs(): Effect.Effect<DOMRefs, DOMError> {
  return Effect.gen(function* () {
    const searchInput = yield* getElementSafe<HTMLInputElement>('configSearch');
    const categoryFilter = yield* getElementSafe<HTMLSelectElement>('configCategoryFilter');
    const showModifiedOnly = yield* getElementSafe<HTMLInputElement>('showModifiedOnly');
    const configTableBody = yield* getElementSafe<HTMLTableSectionElement>('configTableBody');
    const resetAllBtn = yield* getElementSafe<HTMLButtonElement>('resetAllConfig');
    const modifiedCountSpan = yield* Effect.sync(() => document.getElementById('modifiedConfigCount'));
    const statusElement = yield* Effect.sync(() => document.getElementById('configStatus'));

    return {
      searchInput,
      categoryFilter,
      showModifiedOnly,
      configTableBody,
      resetAllBtn,
      modifiedCountSpan,
      statusElement,
    };
  });
}

function populateCategoryFilter(categoryFilter: HTMLSelectElement): Effect.Effect<void> {
  return Effect.sync(() => {
    categoryFilter.appendChild(
      createElement('option', { textContent: 'All Categories', attributes: { value: '' } })
    );

    Object.values(CONFIG_CATEGORIES).forEach((category) => {
      categoryFilter.appendChild(
        createElement('option', { textContent: category, attributes: { value: category } })
      );
    });
  });
}

function getFilteredEntries(
  domRefs: DOMRefs,
  allEntries: ConfigEntryWithMetadata[]
): ConfigEntryWithMetadata[] {
  const query = domRefs.searchInput.value.trim();
  const category = domRefs.categoryFilter.value;
  const modifiedOnly = domRefs.showModifiedOnly.checked;

  let entries = query
    ? allEntries.filter(
        (e) =>
          e.key.toLowerCase().includes(query.toLowerCase()) ||
          e.description.toLowerCase().includes(query.toLowerCase())
      )
    : allEntries;

  if (category) {
    entries = entries.filter((e) => e.category === category);
  }

  if (modifiedOnly) {
    entries = entries.filter((e) => e.isModified);
  }

  return entries;
}

function formatValue(value: number | string | boolean, type: string): HTMLElement {
  if (type === 'boolean') {
    return createElement('span', { className: 'value-boolean', textContent: String(value) });
  }
  if (type === 'number') {
    const formatted = typeof value === 'number' ? value.toLocaleString() : String(value);
    return createElement('span', { className: 'value-number', textContent: formatted });
  }
  if (type === 'textarea') {
    const strValue = String(value);
    const truncated = strValue.length > 50 ? `${strValue.slice(0, 50)}...` : strValue;
    const firstLine = truncated.split('\n')[0];
    return createElement('span', { className: 'value-textarea', textContent: `"${firstLine}"` });
  }
  return createElement('span', { className: 'value-string', textContent: `"${value}"` });
}

function renderValueDisplay(entry: ConfigEntryWithMetadata): HTMLElement {
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

function renderEditInput(entry: ConfigEntryWithMetadata, container: HTMLElement): void {
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
            entry.currentValue === true ? { value: 'true', selected: '' } : { value: 'true' },
        }),
        createElement('option', {
          textContent: 'false',
          attributes:
            entry.currentValue === false ? { value: 'false', selected: '' } : { value: 'false' },
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

function renderConfigTable(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>
): Effect.Effect<void, never, ConfigService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const state = yield* Ref.get(stateRef);
    const allEntries = yield* configService.getAllEntries;
    const entries = getFilteredEntries(domRefs, allEntries);

    yield* Effect.sync(() => {
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
        entries.forEach((entry) => {
          const [mainRow, descRow] = renderConfigRow(entry, state.editingKey);
          fragment.appendChild(mainRow);
          fragment.appendChild(descRow);
        });
      }

      clearChildren(domRefs.configTableBody);
      domRefs.configTableBody.appendChild(fragment);
    });
  });
}

function updateModifiedCount(
  domRefs: DOMRefs
): Effect.Effect<void, never, ConfigService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const count = yield* configService.getModifiedCount;

    yield* Effect.sync(() => {
      if (domRefs.modifiedCountSpan) {
        domRefs.modifiedCountSpan.textContent = count.toString();
        domRefs.modifiedCountSpan.parentElement?.classList.toggle('hidden', count === 0);
      }
      domRefs.resetAllBtn.disabled = count === 0;
    });
  });
}


function startEditing(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>,
  key: string
): Effect.Effect<void, never, ConfigService> {
  return Effect.gen(function* () {
    yield* Ref.set(stateRef, { editingKey: key });
    yield* renderConfigTable(domRefs, stateRef);

    yield* Effect.sync(() => {
      const input = document.querySelector(
        `.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"], .config-edit-textarea[data-key="${key}"]`
      );
      if (input) {
        (input as HTMLElement).focus();
        if (input instanceof HTMLInputElement) {
          input.select();
        } else if (input instanceof HTMLTextAreaElement) {
          input.setSelectionRange(0, 0);
        }
      }
    });
  });
}

function cancelEditing(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>
): Effect.Effect<void, never, ConfigService> {
  return Effect.gen(function* () {
    yield* Ref.set(stateRef, { editingKey: null });
    yield* renderConfigTable(domRefs, stateRef);
  });
}

function saveEdit(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>,
  key: string
): Effect.Effect<void, never, ConfigService | UIService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const uiService = yield* UIService;
    const allEntries = yield* configService.getAllEntries;
    const entry = allEntries.find((e) => e.key === key);
    if (!entry) return;

    const input = yield* Effect.sync(() =>
      document.querySelector(
        `.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"], .config-edit-textarea[data-key="${key}"]`
      )
    );
    if (!input) return;

    const newValue = yield* Effect.sync(() => {
      if (entry.type === 'boolean') {
        return (input as HTMLSelectElement).value === 'true';
      } else if (entry.type === 'number') {
        const value = parseFloat((input as HTMLInputElement).value);
        if (isNaN(value)) {
          throw new Error('Invalid number');
        }
        return value;
      } else if (entry.type === 'textarea') {
        return (input as HTMLTextAreaElement).value;
      } else {
        return (input as HTMLInputElement).value;
      }
    });

    yield* configService.setValue(key, newValue).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if (domRefs.statusElement) {
            yield* uiService.showStatus(domRefs.statusElement, getErrorMessage(error), 'error');
          }
        })
      ),
      Effect.flatMap(() =>
        Effect.gen(function* () {
          yield* Ref.set(stateRef, { editingKey: null });
          yield* renderConfigTable(domRefs, stateRef);
          yield* updateModifiedCount(domRefs);
          if (domRefs.statusElement) {
            yield* uiService.showStatus(domRefs.statusElement, `Updated ${key}`, 'success');
          }
        })
      )
    );
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.gen(function* () {
        const uiService = yield* UIService;
        if (domRefs.statusElement) {
          yield* uiService.showStatus(domRefs.statusElement, getErrorMessage(defect), 'error');
        }
      })
    )
  );
}

function resetValue(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>,
  key: string
): Effect.Effect<void, never, ConfigService | UIService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const uiService = yield* UIService;
    yield* configService.resetValue(key).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if (domRefs.statusElement) {
            yield* uiService.showStatus(domRefs.statusElement, getErrorMessage(error), 'error');
          }
        })
      ),
      Effect.flatMap(() =>
        Effect.gen(function* () {
          yield* renderConfigTable(domRefs, stateRef);
          yield* updateModifiedCount(domRefs);
          if (domRefs.statusElement) {
            yield* uiService.showStatus(domRefs.statusElement, `Reset ${key} to default`, 'success');
          }
        })
      )
    );
  });
}

function handleTableClick(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>,
  event: MouseEvent
): Effect.Effect<void, never, ConfigService | UIService> {
  return Effect.gen(function* () {
    const target = event.target as HTMLElement;

    if (target.classList.contains('value-display')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* startEditing(domRefs, stateRef, key);
      }
      return;
    }

    if (target.classList.contains('btn-save')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* saveEdit(domRefs, stateRef, key);
      }
      return;
    }

    if (target.classList.contains('btn-cancel')) {
      yield* cancelEditing(domRefs, stateRef);
      return;
    }

    if (target.classList.contains('btn-reset')) {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* resetValue(domRefs, stateRef, key);
      }
      return;
    }
  });
}

function handleTableKeydown(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>,
  event: KeyboardEvent
): Effect.Effect<void, never, ConfigService | UIService> {
  return Effect.gen(function* () {
    const target = event.target as HTMLElement;

    if (target.classList.contains('value-display') && event.key === 'Enter') {
      const key = target.dataset.key;
      if (key !== undefined && key !== '') {
        yield* startEditing(domRefs, stateRef, key);
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
        yield* saveEdit(domRefs, stateRef, key);
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
        yield* saveEdit(domRefs, stateRef, key);
      }
      return;
    }

    if (
      (target.classList.contains('config-edit-input') ||
        target.classList.contains('config-edit-select') ||
        target.classList.contains('config-edit-textarea')) &&
      event.key === 'Escape'
    ) {
      yield* cancelEditing(domRefs, stateRef);
      return;
    }
  });
}

function setupEventListeners(
  domRefs: DOMRefs,
  stateRef: Ref.Ref<ModuleState>
): Effect.Effect<void, never, ConfigService | UIService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const uiService = yield* UIService;

    yield* Effect.sync(() => {
      domRefs.searchInput.addEventListener('input', () => {
        Effect.runPromise(Effect.provide(renderConfigTable(domRefs, stateRef), configService));
      });

      domRefs.categoryFilter.addEventListener('change', () => {
        Effect.runPromise(Effect.provide(renderConfigTable(domRefs, stateRef), configService));
      });

      domRefs.showModifiedOnly.addEventListener('change', () => {
        Effect.runPromise(Effect.provide(renderConfigTable(domRefs, stateRef), configService));
      });

      domRefs.resetAllBtn.addEventListener('click', () => {
        Effect.runPromise(
          Effect.provide(
            Effect.gen(function* () {
              const configService = yield* ConfigService;
              const uiService = yield* UIService;
              const count = yield* configService.getModifiedCount;
              if (count === 0) return;

              const confirmed = confirm(
                'Are you sure you want to reset all modified settings to their default values?\n\n' +
                  'This action cannot be undone.'
              );

              if (confirmed) {
                yield* configService.resetAll.pipe(
                  Effect.catchAll((error) =>
                    Effect.gen(function* () {
                      if (domRefs.statusElement) {
                        yield* uiService.showStatus(domRefs.statusElement, getErrorMessage(error), 'error');
                      }
                    })
                  ),
                  Effect.flatMap(() =>
                    Effect.gen(function* () {
                      yield* renderConfigTable(domRefs, stateRef);
                      yield* updateModifiedCount(domRefs);
                      if (domRefs.statusElement) {
                        yield* uiService.showStatus(domRefs.statusElement, 'All settings have been reset to defaults.', 'success');
                      }
                    })
                  )
                );
              }
            }),
            Layer.mergeAll(ConfigService.context(configService), UIService.context(uiService))
          )
        );
      });

      domRefs.configTableBody.addEventListener('click', (event) => {
        Effect.runPromise(Effect.provide(handleTableClick(domRefs, stateRef, event), Layer.mergeAll(ConfigService.context(configService), UIService.context(uiService))));
      });

      domRefs.configTableBody.addEventListener('keydown', (event) => {
        Effect.runPromise(Effect.provide(handleTableKeydown(domRefs, stateRef, event), Layer.mergeAll(ConfigService.context(configService), UIService.context(uiService))));
      });
    });
  });
}

export function initAdvancedConfigModule(): Effect.Effect<void, DOMError, ConfigService | UIService> {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;

    yield* configService.ensureLoaded.pipe(
      Effect.catchAll(() => Effect.succeed(undefined))
    );

    const domRefs = yield* getDOMRefs();
    const stateRef = yield* Ref.make<ModuleState>({ editingKey: null });

    yield* populateCategoryFilter(domRefs.categoryFilter);
    yield* setupEventListeners(domRefs, stateRef);
    yield* renderConfigTable(domRefs, stateRef);
    yield* updateModifiedCount(domRefs);
  });
}
