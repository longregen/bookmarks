import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage } from '../../lib/dom';
import { initSettingsForm, withButtonState } from '../../lib/form-helper';
import { makeApiRequest } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';

const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const chatModelInput = document.getElementById('chatModel') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;

async function loadSettings() {
  const settings = await getSettings();

  apiBaseUrlInput.value = settings.apiBaseUrl;
  apiKeyInput.value = settings.apiKey;
  chatModelInput.value = settings.chatModel;
  embeddingModelInput.value = settings.embeddingModel;
}

async function saveSettings() {
  await saveSetting('apiBaseUrl', apiBaseUrlInput.value.trim());
  await saveSetting('apiKey', apiKeyInput.value.trim());
  await saveSetting('chatModel', chatModelInput.value.trim());
  await saveSetting('embeddingModel', embeddingModelInput.value.trim());
}

testBtn.addEventListener('click', async () => {
  try {
    await withButtonState(testBtn, 'Testing...', async () => {
      const settings = {
        apiBaseUrl: apiBaseUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        embeddingModel: embeddingModelInput.value.trim(),
      };

      // Test the API with a simple embedding request
      await makeApiRequest('/embeddings', {
        model: settings.embeddingModel,
        input: ['test'],
      }, settings);
    });

    showStatusMessage(statusDiv, 'Connection successful! API is working correctly.', 'success', 5000);
  } catch (error) {
    console.error('Error testing connection:', error);
    showStatusMessage(statusDiv, `Connection failed: ${getErrorMessage(error)}`, 'error', 5000);
  }
});

export function initSettingsModule() {
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
