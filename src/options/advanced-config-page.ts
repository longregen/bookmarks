import { initThemeModule } from './modules/theme';
import { initAdvancedConfigModule } from './modules/advanced-config';

async function initializeModules(): Promise<void> {
  initThemeModule();
  await initAdvancedConfigModule();
}

void initializeModules();
