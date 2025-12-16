/**
 * Options Page - Main Entry Point
 *
 * This is the main entry point for the options page.
 * It imports and initializes all the modular components.
 */

import { initSettingsModule } from './modules/settings';
import { initWebDAVModule } from './modules/webdav';
import { initImportExportModule } from './modules/import-export';
import { initBulkImportModule } from './modules/bulk-import';
import { initThemeModule } from './modules/theme';
import { initNavigationModule } from './modules/navigation';
import { initAdvancedConfigModule } from './modules/advanced-config';

// Store cleanup functions
const cleanupFunctions: (() => void)[] = [];

// Initialize all modules
async function initializeModules() {
  // Initialize theme first to apply correct styles
  initThemeModule();

  // Initialize navigation
  initNavigationModule();

  // Initialize settings module
  initSettingsModule();

  // Initialize WebDAV module (returns cleanup function)
  const webdavCleanup = initWebDAVModule();
  if (webdavCleanup) cleanupFunctions.push(webdavCleanup);

  // Initialize import/export module
  initImportExportModule();

  // Initialize bulk import module (returns cleanup function)
  const bulkImportCleanup = initBulkImportModule();
  if (bulkImportCleanup) cleanupFunctions.push(bulkImportCleanup);

  // Initialize advanced config module (async - loads config from IndexedDB)
  await initAdvancedConfigModule();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupFunctions.forEach(cleanup => cleanup());
});

// Initialize when DOM is ready
initializeModules();
