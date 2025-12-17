import {
  CONFIG_REGISTRY,
  CONFIG_CATEGORIES,
  getAllConfigEntries,
  searchConfigEntries,
  setConfigValue,
  resetConfigValue,
  resetAllConfigValues,
  getModifiedCount,
  ensureConfigLoaded,
  type ConfigEntry,
} from '../../lib/config-registry';
import { createElement, getElement } from '../../lib/dom';
import { getErrorMessage } from '../../lib/errors';

let searchInput: HTMLInputElement;
let categoryFilter: HTMLSelectElement;
let showModifiedOnly: HTMLInputElement;
let configTableBody: HTMLTableSectionElement;
let resetAllBtn: HTMLButtonElement;
let modifiedCountSpan: HTMLElement | null = null;

let editingKey: string | null = null;

export async function initAdvancedConfigModule(): Promise<void> {
  await ensureConfigLoaded();

  searchInput = getElement<HTMLInputElement>('configSearch');
  categoryFilter = getElement<HTMLSelectElement>('configCategoryFilter');
  showModifiedOnly = getElement<HTMLInputElement>('showModifiedOnly');
  configTableBody = getElement<HTMLTableSectionElement>('configTableBody');
  resetAllBtn = getElement<HTMLButtonElement>('resetAllConfig');
  modifiedCountSpan = document.getElementById('modifiedConfigCount');

  populateCategoryFilter();

  setupEventListeners();

  renderConfigTable();
  updateModifiedCount();
}

function populateCategoryFilter(): void {
  categoryFilter.appendChild(
    createElement('option', { textContent: 'All Categories', attributes: { value: '' } })
  );

  Object.values(CONFIG_CATEGORIES).forEach(category => {
    categoryFilter.appendChild(
      createElement('option', { textContent: category, attributes: { value: category } })
    );
  });
}

function setupEventListeners(): void {
  searchInput.addEventListener('input', () => {
    renderConfigTable();
  });

  categoryFilter.addEventListener('change', () => {
    renderConfigTable();
  });

  showModifiedOnly.addEventListener('change', () => {
    renderConfigTable();
  });

  resetAllBtn.addEventListener('click', async () => {
    if (getModifiedCount() === 0) return;

    // eslint-disable-next-line no-alert
    const confirmed = confirm(
      'Are you sure you want to reset all modified settings to their default values?\n\n' +
      'This action cannot be undone.'
    );

    if (confirmed) {
      await resetAllConfigValues();
      renderConfigTable();
      updateModifiedCount();
      showStatus('All settings have been reset to defaults.', 'success');
    }
  });

  configTableBody.addEventListener('click', handleTableClick);
  configTableBody.addEventListener('keydown', handleTableKeydown);
}

function getFilteredEntries(): (ConfigEntry & { currentValue: number | string | boolean; isModified: boolean })[] {
  const query = searchInput.value.trim();
  const category = categoryFilter.value;
  const modifiedOnly = showModifiedOnly.checked;

  let entries = query ? searchConfigEntries(query) : getAllConfigEntries();

  if (category) {
    entries = entries.filter(e => e.category === category);
  }

  if (modifiedOnly) {
    entries = entries.filter(e => e.isModified);
  }

  return entries;
}

function clearChildren(element: HTMLElement): void {
  element.replaceChildren();
}

function renderConfigTable(): void {
  clearChildren(configTableBody);

  const entries = getFilteredEntries();

  if (entries.length === 0) {
    const emptyRow = createElement('tr', {}, [
      createElement('td', {
        className: 'config-empty',
        textContent: 'No configuration entries found matching your criteria.',
        attributes: { colspan: '5' }
      })
    ]);
    configTableBody.appendChild(emptyRow);
    return;
  }

  entries.forEach(entry => {
    const [mainRow, descRow] = renderConfigRow(entry);
    configTableBody.appendChild(mainRow);
    configTableBody.appendChild(descRow);
  });
}

function renderConfigRow(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): [HTMLTableRowElement, HTMLTableRowElement] {
  const isEditing = editingKey === entry.key;
  const modifiedClass = entry.isModified ? 'config-modified' : '';

  const keyCell = createElement('td', { className: 'config-key' }, [
    createElement('span', { className: 'key-name', textContent: entry.key }),
    createElement('span', { className: 'key-category', textContent: entry.category })
  ]);

  const typeCell = createElement('td', { className: 'config-type', textContent: entry.type });

  const valueCell = createElement('td', {
    className: 'config-value',
    attributes: { 'data-key': entry.key }
  });
  if (isEditing) {
    renderEditInput(entry, valueCell);
  } else {
    valueCell.appendChild(renderValueDisplay(entry));
  }

  const defaultCell = createElement('td', {
    className: 'config-default',
    title: `Default: ${entry.defaultValue}`
  });
  defaultCell.appendChild(formatValue(entry.defaultValue, entry.type));

  const actionsCell = createElement('td', { className: 'config-actions' });
  if (entry.isModified) {
    const resetBtn = createElement('button', {
      className: 'btn-reset',
      textContent: 'Reset',
      title: 'Reset to default',
      attributes: { 'data-key': entry.key }
    });
    actionsCell.appendChild(resetBtn);
  }

  const mainRow = createElement('tr', {
    className: `config-row ${modifiedClass}`.trim(),
    attributes: { 'data-key': entry.key }
  }, [keyCell, typeCell, valueCell, defaultCell, actionsCell]);

  const descRow = createElement('tr', { className: `config-description-row ${modifiedClass}`.trim() }, [
    createElement('td', {
      className: 'config-description',
      textContent: entry.description,
      attributes: { colspan: '5' }
    })
  ]);

  return [mainRow, descRow];
}

function renderValueDisplay(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): HTMLElement {
  const valueSpan = createElement('span', {
    className: 'value-display',
    attributes: {
      'data-key': entry.key,
      tabindex: '0',
      role: 'button',
      'aria-label': `Click to edit ${entry.key}`
    }
  });
  valueSpan.appendChild(formatValue(entry.currentValue, entry.type));
  return valueSpan;
}

function renderEditInput(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }, container: HTMLElement): void {
  if (entry.type === 'boolean') {
    const select = createElement('select', {
      className: 'config-edit-select',
      attributes: { 'data-key': entry.key, autofocus: '' }
    }, [
      createElement('option', {
        textContent: 'true',
        attributes: entry.currentValue === true ? { value: 'true', selected: '' } : { value: 'true' }
      }),
      createElement('option', {
        textContent: 'false',
        attributes: entry.currentValue === false ? { value: 'false', selected: '' } : { value: 'false' }
      })
    ]);
    container.appendChild(select);
  } else {
    const inputType = entry.type === 'number' ? 'number' : 'text';
    const attrs: Record<string, string> = {
      type: inputType,
      'data-key': entry.key,
      value: String(entry.currentValue),
      autofocus: ''
    };

    if (entry.type === 'number' && entry.key.includes('TEMPERATURE')) {
      attrs.step = '0.1';
    }
    if (entry.min !== undefined) attrs.min = String(entry.min);
    if (entry.max !== undefined) attrs.max = String(entry.max);

    const input = createElement('input', {
      className: 'config-edit-input',
      attributes: attrs
    });
    container.appendChild(input);
  }

  container.appendChild(createElement('button', {
    className: 'btn-save',
    textContent: 'Save',
    attributes: { 'data-key': entry.key }
  }));

  container.appendChild(createElement('button', {
    className: 'btn-cancel',
    textContent: 'Cancel',
    attributes: { 'data-key': entry.key }
  }));
}

function formatValue(value: number | string | boolean, type: string): HTMLElement {
  if (type === 'boolean') {
    return createElement('span', { className: 'value-boolean', textContent: String(value) });
  }
  if (type === 'number') {
    // Format large numbers with commas
    const formatted = typeof value === 'number' ? value.toLocaleString() : String(value);
    return createElement('span', { className: 'value-number', textContent: formatted });
  }
  return createElement('span', { className: 'value-string', textContent: `"${value}"` });
}

async function handleTableClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;

  if (target.classList.contains('value-display')) {
    const key = target.dataset.key;
    if (key !== undefined && key !== '') {
      startEditing(key);
    }
    return;
  }

  if (target.classList.contains('btn-save')) {
    const key = target.dataset.key;
    if (key !== undefined && key !== '') {
      await saveEdit(key);
    }
    return;
  }

  if (target.classList.contains('btn-cancel')) {
    cancelEditing();
    return;
  }

  if (target.classList.contains('btn-reset')) {
    const key = target.dataset.key;
    if (key !== undefined && key !== '') {
      await resetValue(key);
    }
    return;
  }
}

async function handleTableKeydown(event: KeyboardEvent): Promise<void> {
  const target = event.target as HTMLElement;

  if (target.classList.contains('value-display') && event.key === 'Enter') {
    const key = target.dataset.key;
    if (key !== undefined && key !== '') {
      startEditing(key);
    }
    return;
  }

  if ((target.classList.contains('config-edit-input') || target.classList.contains('config-edit-select')) && event.key === 'Enter') {
    const key = target.dataset.key;
    if (key !== undefined && key !== '') {
      await saveEdit(key);
    }
    return;
  }

  if ((target.classList.contains('config-edit-input') || target.classList.contains('config-edit-select')) && event.key === 'Escape') {
    cancelEditing();
    return;
  }
}

function startEditing(key: string): void {
  editingKey = key;
  renderConfigTable();

  const input = document.querySelector(`.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"]`);
  if (input) {
    (input as HTMLElement).focus();
    if (input instanceof HTMLInputElement) {
      input.select();
    }
  }
}

function cancelEditing(): void {
  editingKey = null;
  renderConfigTable();
}

async function saveEdit(key: string): Promise<void> {
  const entry = CONFIG_REGISTRY.find(e => e.key === key);
  if (!entry) return;

  const input = document.querySelector(`.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"]`);
  if (!input) return;

  try {
    let newValue: number | string | boolean;

    if (entry.type === 'boolean') {
      newValue = (input as HTMLSelectElement).value === 'true';
    } else if (entry.type === 'number') {
       
      newValue = parseFloat((input as HTMLInputElement).value);
      if (isNaN(newValue)) {
        throw new Error('Invalid number');
      }
    } else {
       
      newValue = (input as HTMLInputElement).value;
    }

    await setConfigValue(key, newValue);
    editingKey = null;
    renderConfigTable();
    updateModifiedCount();
    showStatus(`Updated ${key}`, 'success');
  } catch (error) {
    showStatus(getErrorMessage(error), 'error');
  }
}

async function resetValue(key: string): Promise<void> {
  try {
    await resetConfigValue(key);
    renderConfigTable();
    updateModifiedCount();
    showStatus(`Reset ${key} to default`, 'success');
  } catch (error) {
    showStatus(getErrorMessage(error), 'error');
  }
}

function updateModifiedCount(): void {
  const count = getModifiedCount();
  if (modifiedCountSpan) {
    modifiedCountSpan.textContent = count.toString();
    modifiedCountSpan.parentElement?.classList.toggle('hidden', count === 0);
  }
  resetAllBtn.disabled = count === 0;
}

function showStatus(message: string, type: 'success' | 'error'): void {
  const status = document.getElementById('configStatus');
  if (!status) return;

  status.textContent = message;
  status.className = `config-status ${type}`;
  status.classList.remove('hidden');

  // Auto-hide after 3 seconds
  setTimeout(() => {
    status.classList.add('hidden');
  }, 3000);
}
