import { setPlatformAdapter } from './platform';
import { extensionAdapter } from './adapters/extension';
import { initTheme } from '../shared/theme';

export async function initExtension(): Promise<void> {
  setPlatformAdapter(extensionAdapter);
  await initTheme();
}
