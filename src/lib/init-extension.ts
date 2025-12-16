import { setPlatformAdapter } from './platform';
import { extensionAdapter } from './adapters/extension';
import { initTheme } from '../shared/theme';

/**
 * Initialize the extension platform adapter and theme
 * Call this at the start of each extension page
 */
export async function initExtension(): Promise<void> {
  setPlatformAdapter(extensionAdapter);
  await initTheme();
}
