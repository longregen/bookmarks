import '../shared/app.css';
import { initSettingsModule } from './modules/settings';
import { initBulkImportModule } from './modules/bulk-import';
import { initServerSyncModule } from './modules/server-sync';
import { initSelfHealingModule } from './modules/self-healing';
import { initThemeModule } from './modules/theme';
import { initNavigationModule } from './modules/navigation';
import './modules/import-export';

const cleanupFunctions: (() => void)[] = [];

function initializeModules(): void {
  initThemeModule();
  initNavigationModule();
  initSettingsModule();

  const bulkImportCleanup = initBulkImportModule();
  cleanupFunctions.push(bulkImportCleanup);

  const serverSyncCleanup = initServerSyncModule();
  cleanupFunctions.push(serverSyncCleanup);

  const selfHealingCleanup = initSelfHealingModule();
  cleanupFunctions.push(selfHealingCleanup);
}

window.addEventListener('beforeunload', () => {
  cleanupFunctions.forEach(cleanup => cleanup());
});

initializeModules();
