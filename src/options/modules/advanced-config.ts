/**
 * Advanced Configuration Module
 *
 * Firefox about:config inspired interface for modifying internal constants.
 * Allows power users to customize application behavior.
 */

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
import { createElement } from '../../lib/dom';

// DOM Elements
let searchInput: HTMLInputElement | null = null;
let categoryFilter: HTMLSelectElement | null = null;
let showModifiedOnly: HTMLInputElement | null = null;
let configTableBody: HTMLTableSectionElement | null = null;
let resetAllBtn: HTMLButtonElement | null = null;
let modifiedCountSpan: HTMLElement | null = null;

// Currently editing row
let editingKey: string | null = null;

/**
 * Initialize the advanced config module
 */
export async function initAdvancedConfigModule(): Promise<void> {
  // Ensure config overrides are loaded
  await ensureConfigLoaded();

  // Get DOM elements
  searchInput = document.getElementById('configSearch') as HTMLInputElement;
  categoryFilter = document.getElementById('configCategoryFilter') as HTMLSelectElement;
  showModifiedOnly = document.getElementById('showModifiedOnly') as HTMLInputElement;
  configTableBody = document.getElementById('configTableBody') as HTMLTableSectionElement;
  resetAllBtn = document.getElementById('resetAllConfig') as HTMLButtonElement;
  modifiedCountSpan = document.getElementById('modifiedConfigCount');

  if (!configTableBody) {
    console.warn('Advanced config table body not found');
    return;
  }

  // Populate category filter
  populateCategoryFilter();

  // Setup event listeners
  setupEventListeners();

  // Initial render
  renderConfigTable();
  updateModifiedCount();
}

/**
 * Populate the category filter dropdown
 */
function populateCategoryFilter(): void {
  if (!categoryFilter) return;

  // Add "All Categories" option
  categoryFilter.appendChild(
    createElement('option', { textContent: 'All Categories', attributes: { value: '' } })
  );

  // Add each category
  Object.values(CONFIG_CATEGORIES).forEach(category => {
    categoryFilter.appendChild(
      createElement('option', { textContent: category, attributes: { value: category } })
    );
  });
}

/**
 * Setup event listeners
 */
function setupEventListeners(): void {
  // Search input
  searchInput?.addEventListener('input', () => {
    renderConfigTable();
  });

  // Category filter
  categoryFilter?.addEventListener('change', () => {
    renderConfigTable();
  });

  // Show modified only toggle
  showModifiedOnly?.addEventListener('change', () => {
    renderConfigTable();
  });

  // Reset all button
  resetAllBtn?.addEventListener('click', async () => {
    if (getModifiedCount() === 0) return;

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

  // Handle clicks on the table for edit/reset buttons
  configTableBody?.addEventListener('click', handleTableClick);
  configTableBody?.addEventListener('keydown', handleTableKeydown);
}

/**
 * Get filtered config entries based on current filters
 */
function getFilteredEntries(): Array<ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }> {
  const query = searchInput?.value.trim() || '';
  const category = categoryFilter?.value || '';
  const modifiedOnly = showModifiedOnly?.checked || false;

  let entries = query ? searchConfigEntries(query) : getAllConfigEntries();

  if (category) {
    entries = entries.filter(e => e.category === category);
  }

  if (modifiedOnly) {
    entries = entries.filter(e => e.isModified);
  }

  return entries;
}

/**
 * Clear all children from an element
 */
function clearChildren(element: HTMLElement): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

/**
 * Render the config table
 */
function renderConfigTable(): void {
  if (!configTableBody) return;

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

/**
 * Render a single config row - returns [mainRow, descriptionRow]
 */
function renderConfigRow(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): [HTMLTableRowElement, HTMLTableRowElement] {
  const isEditing = editingKey === entry.key;
  const modifiedClass = entry.isModified ? 'config-modified' : '';

  // Key cell
  const keyCell = createElement('td', { className: 'config-key' }, [
    createElement('span', { className: 'key-name', textContent: entry.key }),
    createElement('span', { className: 'key-category', textContent: entry.category })
  ]);

  // Type cell
  const typeCell = createElement('td', { className: 'config-type', textContent: entry.type });

  // Value cell
  const valueCell = createElement('td', {
    className: 'config-value',
    attributes: { 'data-key': entry.key }
  });
  if (isEditing) {
    renderEditInput(entry, valueCell);
  } else {
    valueCell.appendChild(renderValueDisplay(entry));
  }

  // Default cell
  const defaultCell = createElement('td', {
    className: 'config-default',
    title: `Default: ${entry.defaultValue}`
  });
  defaultCell.appendChild(formatValue(entry.defaultValue, entry.type));

  // Actions cell
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

  // Main row
  const mainRow = createElement('tr', {
    className: `config-row ${modifiedClass}`.trim(),
    attributes: { 'data-key': entry.key }
  }, [keyCell, typeCell, valueCell, defaultCell, actionsCell]) as HTMLTableRowElement;

  // Description row
  const descRow = createElement('tr', { className: `config-description-row ${modifiedClass}`.trim() }, [
    createElement('td', {
      className: 'config-description',
      textContent: entry.description,
      attributes: { colspan: '5' }
    })
  ]) as HTMLTableRowElement;

  return [mainRow, descRow];
}

/**
 * Render the value display (clickable to edit)
 */
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

/**
 * Render the edit input into a container
 */
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

  // Save button
  container.appendChild(createElement('button', {
    className: 'btn-save',
    textContent: 'Save',
    attributes: { 'data-key': entry.key }
  }));

  // Cancel button
  container.appendChild(createElement('button', {
    className: 'btn-cancel',
    textContent: 'Cancel',
    attributes: { 'data-key': entry.key }
  }));
}

/**
 * Format a value for display - returns an element
 */
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

/**
 * Handle clicks on the table
 */
async function handleTableClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;

  // Click on value display to edit
  if (target.classList.contains('value-display')) {
    const key = target.dataset.key;
    if (key) {
      startEditing(key);
    }
    return;
  }

  // Click save button
  if (target.classList.contains('btn-save')) {
    const key = target.dataset.key;
    if (key) {
      await saveEdit(key);
    }
    return;
  }

  // Click cancel button
  if (target.classList.contains('btn-cancel')) {
    cancelEditing();
    return;
  }

  // Click reset button
  if (target.classList.contains('btn-reset')) {
    const key = target.dataset.key;
    if (key) {
      await resetValue(key);
    }
    return;
  }
}

/**
 * Handle keyboard events on the table
 */
async function handleTableKeydown(event: KeyboardEvent): Promise<void> {
  const target = event.target as HTMLElement;

  // Enter on value display to edit
  if (target.classList.contains('value-display') && event.key === 'Enter') {
    const key = target.dataset.key;
    if (key) {
      startEditing(key);
    }
    return;
  }

  // Enter in edit input to save
  if ((target.classList.contains('config-edit-input') || target.classList.contains('config-edit-select')) && event.key === 'Enter') {
    const key = target.dataset.key;
    if (key) {
      await saveEdit(key);
    }
    return;
  }

  // Escape in edit input to cancel
  if ((target.classList.contains('config-edit-input') || target.classList.contains('config-edit-select')) && event.key === 'Escape') {
    cancelEditing();
    return;
  }
}

/**
 * Start editing a config value
 */
function startEditing(key: string): void {
  editingKey = key;
  renderConfigTable();

  // Focus the input
  const input = document.querySelector(`.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"]`) as HTMLInputElement | HTMLSelectElement;
  if (input) {
    input.focus();
    if (input instanceof HTMLInputElement) {
      input.select();
    }
  }
}

/**
 * Cancel editing
 */
function cancelEditing(): void {
  editingKey = null;
  renderConfigTable();
}

/**
 * Save the edited value
 */
async function saveEdit(key: string): Promise<void> {
  const entry = CONFIG_REGISTRY.find(e => e.key === key);
  if (!entry) return;

  const input = document.querySelector(`.config-edit-input[data-key="${key}"], .config-edit-select[data-key="${key}"]`) as HTMLInputElement | HTMLSelectElement;
  if (!input) return;

  try {
    let newValue: number | string | boolean;

    if (entry.type === 'boolean') {
      newValue = input.value === 'true';
    } else if (entry.type === 'number') {
      newValue = parseFloat(input.value);
      if (isNaN(newValue)) {
        throw new Error('Invalid number');
      }
    } else {
      newValue = input.value;
    }

    await setConfigValue(key, newValue);
    editingKey = null;
    renderConfigTable();
    updateModifiedCount();
    showStatus(`Updated ${key}`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save value';
    showStatus(message, 'error');
  }
}

/**
 * Reset a value to default
 */
async function resetValue(key: string): Promise<void> {
  try {
    await resetConfigValue(key);
    renderConfigTable();
    updateModifiedCount();
    showStatus(`Reset ${key} to default`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset value';
    showStatus(message, 'error');
  }
}

/**
 * Update the modified count display
 */
function updateModifiedCount(): void {
  const count = getModifiedCount();
  if (modifiedCountSpan) {
    modifiedCountSpan.textContent = count.toString();
    modifiedCountSpan.parentElement?.classList.toggle('hidden', count === 0);
  }
  if (resetAllBtn) {
    resetAllBtn.disabled = count === 0;
  }
}

/**
 * Show a status message
 */
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
