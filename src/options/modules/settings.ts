import { getSettings, saveSetting } from '../../lib/settings';
import { initSettingsForm, withButtonState } from '../../ui/form-helper';
import { makeApiRequest } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { getElement } from '../../ui/dom';

const testBtn = getElement<HTMLButtonElement>('testBtn');
const testConnectionStatus = getElement<HTMLDivElement>('testConnectionStatus');

const apiBaseUrlInput = getElement<HTMLInputElement>('apiBaseUrl');
const apiKeyInput = getElement<HTMLInputElement>('apiKey');
const chatModelInput = getElement<HTMLInputElement>('chatModel');
const embeddingModelInput = getElement<HTMLInputElement>('embeddingModel');

const TEST_BTN_DEFAULT = 'Test Connection';
const TEST_BTN_VERIFIED = 'Access verified';

function resetTestButton(): void {
  if (testBtn.textContent !== TEST_BTN_DEFAULT) {
    testBtn.textContent = TEST_BTN_DEFAULT;
    testConnectionStatus.className = 'test-connection-status hidden';
    testConnectionStatus.textContent = '';
  }
}

[apiBaseUrlInput, apiKeyInput, chatModelInput, embeddingModelInput].forEach(input => {
  input.addEventListener('input', resetTestButton);
});

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
    testConnectionStatus.className = 'test-connection-status testing';
    testConnectionStatus.textContent = 'Testing connection...';

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

    testBtn.textContent = TEST_BTN_VERIFIED;
    testConnectionStatus.className = 'test-connection-status success';
    testConnectionStatus.textContent = '✓ Connection successful! API is working correctly.';
  } catch (error) {
    console.error('Error testing connection:', error);
    testBtn.textContent = TEST_BTN_DEFAULT;
    testConnectionStatus.className = 'test-connection-status error';
    testConnectionStatus.textContent = `✗ Connection failed: ${getErrorMessage(error)}`;
  }
});

export function initSettingsModule(): void {
  if (__IS_WEB__) {
    const apiConfig = document.getElementById('api-config');
    if (apiConfig) {
      apiConfig.style.display = 'none';
    }
    return;
  }

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
