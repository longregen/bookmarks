import { initWeb } from './init-web';
import { getSettings, saveSetting } from '../lib/settings';
import { generateToken, authenticate, isSessionValid } from '../lib/server-auth';
import { serverSync } from '../lib/server-sync';
import { getErrorMessage } from '../lib/errors';

const serverUrlInput = document.getElementById('serverUrlInput') as HTMLInputElement;
const tokenInput = document.getElementById('tokenInput') as HTMLInputElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const connectStatus = document.getElementById('connectStatus') as HTMLDivElement;

function showStatus(message: string, type: 'error' | 'success'): void {
  connectStatus.textContent = message;
  connectStatus.className = type;
}

function clearStatus(): void {
  connectStatus.textContent = '';
  connectStatus.className = '';
}

async function checkExistingSession(): Promise<void> {
  const settings = await getSettings();
  if (settings.serverUrl && settings.serverSessionToken && isSessionValid(settings.serverSessionExpiry)) {
    window.location.href = '../library/library.html';
  }
}

generateBtn.addEventListener('click', () => {
  tokenInput.value = generateToken();
  clearStatus();
});

connectBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const token = tokenInput.value.trim();

  if (!serverUrl) {
    showStatus('Please enter a server URL', 'error');
    return;
  }

  if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
    showStatus('Server URL must start with http:// or https://', 'error');
    return;
  }

  if (!token) {
    showStatus('Please enter or generate a token', 'error');
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  clearStatus();

  try {
    const result = await authenticate(serverUrl, token);

    await saveSetting('serverUrl', serverUrl);
    await saveSetting('serverAuthToken', token);
    await saveSetting('serverEnabled', true);

    showStatus(result.created ? 'Account created! Syncing...' : 'Connected! Syncing...', 'success');

    try {
      await serverSync.fullSync();
    } catch (syncError) {
      console.warn('Initial sync failed:', getErrorMessage(syncError));
    }

    window.location.href = '../library/library.html';
  } catch (error) {
    showStatus(getErrorMessage(error), 'error');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

void (async () => {
  await initWeb();
  await checkExistingSession();
})();
