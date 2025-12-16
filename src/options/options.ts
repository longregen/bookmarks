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
import { initJobsModule } from './modules/jobs';
import { initThemeModule } from './modules/theme';
import { initNavigationModule } from './modules/navigation';

// Store cleanup functions
const cleanupFunctions: (() => void)[] = [];

// Initialize all modules
function initializeModules() {
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

  // Initialize jobs module (returns cleanup function)
  const jobsCleanup = initJobsModule();
  if (jobsCleanup) cleanupFunctions.push(jobsCleanup);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupFunctions.forEach(cleanup => cleanup());
});

// Initialize when DOM is ready
initializeModules();
