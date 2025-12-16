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
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Categories';
  categoryFilter.appendChild(allOption);

  // Add each category
  Object.values(CONFIG_CATEGORIES).forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
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
 * Render the config table
 */
function renderConfigTable(): void {
  if (!configTableBody) return;

  const entries = getFilteredEntries();

  if (entries.length === 0) {
    configTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="config-empty">
          No configuration entries found matching your criteria.
        </td>
      </tr>
    `;
    return;
  }

  configTableBody.innerHTML = entries.map(entry => renderConfigRow(entry)).join('');
}

/**
 * Render a single config row
 */
function renderConfigRow(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): string {
  const isEditing = editingKey === entry.key;
  const modifiedClass = entry.isModified ? 'config-modified' : '';

  const valueDisplay = isEditing
    ? renderEditInput(entry)
    : renderValueDisplay(entry);

  const resetButton = entry.isModified
    ? `<button class="btn-reset" data-key="${entry.key}" title="Reset to default">Reset</button>`
    : '';

  return `
    <tr class="config-row ${modifiedClass}" data-key="${entry.key}">
      <td class="config-key">
        <span class="key-name">${entry.key}</span>
        <span class="key-category">${entry.category}</span>
      </td>
      <td class="config-type">${entry.type}</td>
      <td class="config-value" data-key="${entry.key}">
        ${valueDisplay}
      </td>
      <td class="config-default" title="Default: ${entry.defaultValue}">
        ${formatValue(entry.defaultValue, entry.type)}
      </td>
      <td class="config-actions">
        ${resetButton}
      </td>
    </tr>
    <tr class="config-description-row ${modifiedClass}">
      <td colspan="5" class="config-description">${entry.description}</td>
    </tr>
  `;
}

/**
 * Render the value display (clickable to edit)
 */
function renderValueDisplay(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): string {
  const formattedValue = formatValue(entry.currentValue, entry.type);
  return `
    <span class="value-display" data-key="${entry.key}" tabindex="0" role="button" aria-label="Click to edit ${entry.key}">
      ${formattedValue}
    </span>
  `;
}

/**
 * Render the edit input
 */
function renderEditInput(entry: ConfigEntry & { currentValue: number | string | boolean; isModified: boolean }): string {
  if (entry.type === 'boolean') {
    return `
      <select class="config-edit-select" data-key="${entry.key}" autofocus>
        <option value="true" ${entry.currentValue === true ? 'selected' : ''}>true</option>
        <option value="false" ${entry.currentValue === false ? 'selected' : ''}>false</option>
      </select>
      <button class="btn-save" data-key="${entry.key}">Save</button>
      <button class="btn-cancel" data-key="${entry.key}">Cancel</button>
    `;
  }

  const inputType = entry.type === 'number' ? 'number' : 'text';
  const step = entry.type === 'number' && entry.key.includes('TEMPERATURE') ? '0.1' : '1';
  const min = entry.min !== undefined ? `min="${entry.min}"` : '';
  const max = entry.max !== undefined ? `max="${entry.max}"` : '';

  return `
    <input
      type="${inputType}"
      class="config-edit-input"
      data-key="${entry.key}"
      value="${entry.currentValue}"
      ${step !== '1' ? `step="${step}"` : ''}
      ${min}
      ${max}
      autofocus
    />
    <button class="btn-save" data-key="${entry.key}">Save</button>
    <button class="btn-cancel" data-key="${entry.key}">Cancel</button>
  `;
}

/**
 * Format a value for display
 */
function formatValue(value: number | string | boolean, type: string): string {
  if (type === 'boolean') {
    return `<span class="value-boolean">${value}</span>`;
  }
  if (type === 'number') {
    // Format large numbers with commas
    const formatted = typeof value === 'number' ? value.toLocaleString() : value;
    return `<span class="value-number">${formatted}</span>`;
  }
  return `<span class="value-string">"${value}"</span>`;
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
