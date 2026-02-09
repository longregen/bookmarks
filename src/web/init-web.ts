import { setPlatformAdapter } from '../lib/platform';
import { webAdapter } from '../lib/adapters/web';
import { initTheme } from '../shared/theme';
import { getSettings } from '../lib/settings';
import { isSessionValid } from '../lib/server-auth';
import { serverSync } from '../lib/server-sync';

export async function initWeb(): Promise<void> {
  setPlatformAdapter(webAdapter);
  await initTheme();
}

export async function initWebWithAuth(): Promise<void> {
  await initWeb();

  const settings = await getSettings();
  if (!settings.serverUrl || !settings.serverSessionToken || !isSessionValid(settings.serverSessionExpiry)) {
    window.location.href = '../web/index.html';
    return;
  }

  void serverSync.incrementalSync();
}
