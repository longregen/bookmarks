import { setPlatformAdapter } from '../lib/platform';
import { webAdapter } from '../lib/adapters/web';
import { initTheme } from '../shared/theme';

/**
 * Initialize the web platform adapter and theme
 * Call this at the start of each web app page
 */
export async function initWeb(): Promise<void> {
  setPlatformAdapter(webAdapter);
  await initTheme();
}
