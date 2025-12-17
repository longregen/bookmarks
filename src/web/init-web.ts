import { setPlatformAdapter } from '../lib/platform';
import { webAdapter } from '../lib/adapters/web';
import { initTheme } from '../shared/theme';

export async function initWeb(): Promise<void> {
  setPlatformAdapter(webAdapter);
  await initTheme();
}
