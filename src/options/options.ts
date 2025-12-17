import { initSettingsModule } from './modules/settings';
import { initWebDAVModule } from './modules/webdav';
import { initBulkImportModule } from './modules/bulk-import';
import { initThemeModule } from './modules/theme';
import { initNavigationModule } from './modules/navigation';

const cleanupFunctions: (() => void)[] = [];

function initializeModules(): void {
  initThemeModule();
  initNavigationModule();
  initSettingsModule();

  const webdavCleanup = initWebDAVModule();
  cleanupFunctions.push(webdavCleanup);

  const bulkImportCleanup = initBulkImportModule();
  cleanupFunctions.push(bulkImportCleanup);
}

window.addEventListener('beforeunload', () => {
  cleanupFunctions.forEach(cleanup => cleanup());
});

initializeModules();
