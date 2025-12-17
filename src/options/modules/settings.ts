import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage } from '../../ui/dom';
import { initSettingsForm, withButtonState } from '../../ui/form-helper';
import { makeApiRequest } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';

const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const testConnectionStatus = document.getElementById('testConnectionStatus') as HTMLDivElement;

const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const chatModelInput = document.getElementById('chatModel') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;

async function loadSettings(): Promise<void> {
  const settings = await getSettings();

  apiBaseUrlInput.value = settings.apiBaseUrl;
  apiKeyInput.value = settings.apiKey;
  chatModelInput.value = settings.chatModel;
  embeddingModelInput.value = settings.embeddingModel;
}

async function saveSettings(): Promise<void> {
  await saveSetting('apiBaseUrl', apiBaseUrlInput.value.trim());
  await saveSetting('apiKey', apiKeyInput.value.trim());
  await saveSetting('chatModel', chatModelInput.value.trim());
  await saveSetting('embeddingModel', embeddingModelInput.value.trim());
}

testBtn.addEventListener('click', async () => {
  try {
    testConnectionStatus.className = 'test-connection-status hidden';
    await withButtonState(testBtn, 'Testing...', async () => {
      const settings = {
        apiBaseUrl: apiBaseUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        embeddingModel: embeddingModelInput.value.trim(),
      };

      await makeApiRequest('/embeddings', {
        model: settings.embeddingModel,
        input: ['test'],
      }, settings);
    });

    testConnectionStatus.className = 'test-connection-status success';
    testConnectionStatus.textContent = '✓ Connection successful! API is working correctly.';
  } catch (error) {
    console.error('Error testing connection:', error);
    testConnectionStatus.className = 'test-connection-status error';
    testConnectionStatus.textContent = `✗ Connection failed: ${getErrorMessage(error)}`;
  }
});

export function initSettingsModule(): void {
  initSettingsForm({
    formId: 'settingsForm',
    statusId: 'status',
    onLoad: loadSettings,
    onSave: saveSettings,
    saveButtonText: {
      default: 'Save Settings',
      saving: 'Saving...',
    },
  });
}
