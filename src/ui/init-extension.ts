import { setPlatformAdapter } from '../lib/platform';
import { extensionAdapter } from '../lib/adapters/extension';
import { initTheme } from '../shared/theme';

export async function initExtension(): Promise<void> {
  setPlatformAdapter(extensionAdapter);
  await initTheme();
}
