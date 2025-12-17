import { initSettingsModule } from './modules/settings';
import { initWebDAVModule } from './modules/webdav';
import { initImportExportModule } from './modules/import-export';
import { initBulkImportModule } from './modules/bulk-import';
import { initThemeModule } from './modules/theme';
import { initNavigationModule } from './modules/navigation';
import { initAdvancedConfigModule } from './modules/advanced-config';

const cleanupFunctions: (() => void)[] = [];

async function initializeModules() {
  initThemeModule();
  initNavigationModule();
  initSettingsModule();

  const webdavCleanup = initWebDAVModule();
  if (webdavCleanup) cleanupFunctions.push(webdavCleanup);

  initImportExportModule();

  const bulkImportCleanup = initBulkImportModule();
  if (bulkImportCleanup) cleanupFunctions.push(bulkImportCleanup);

  await initAdvancedConfigModule();
}

window.addEventListener('beforeunload', () => {
  cleanupFunctions.forEach(cleanup => cleanup());
});

initializeModules();
