import { getSettings, saveSetting } from '../../lib/settings';
import { showStatusMessage } from '../../lib/dom';

const form = document.getElementById('settingsForm') as HTMLFormElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const chatModelInput = document.getElementById('chatModel') as HTMLInputElement;
const embeddingModelInput = document.getElementById('embeddingModel') as HTMLInputElement;

async function loadSettings() {
  try {
    const settings = await getSettings();

    apiBaseUrlInput.value = settings.apiBaseUrl;
    apiKeyInput.value = settings.apiKey;
    chatModelInput.value = settings.chatModel;
    embeddingModelInput.value = settings.embeddingModel;
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatusMessage(statusDiv, 'Failed to load settings', 'error', 5000);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    await saveSetting('apiBaseUrl', apiBaseUrlInput.value.trim());
    await saveSetting('apiKey', apiKeyInput.value.trim());
    await saveSetting('chatModel', chatModelInput.value.trim());
    await saveSetting('embeddingModel', embeddingModelInput.value.trim());

    showStatusMessage(statusDiv, 'Settings saved successfully!', 'success', 5000);

    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatusMessage(statusDiv, 'Failed to save settings', 'error', 5000);

    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Settings';
  }
});

testBtn.addEventListener('click', async () => {
  try {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    const settings = {
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      embeddingModel: embeddingModelInput.value.trim(),
    };

    if (!settings.apiKey) {
      showStatusMessage(statusDiv, 'Please enter an API key first', 'error', 5000);
      return;
    }

    // Test the API with a simple embedding request
    const response = await fetch(`${settings.apiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.embeddingModel,
        input: ['test'],
      }),
    });

    if (response.ok) {
      showStatusMessage(statusDiv, 'Connection successful! API is working correctly.', 'success', 5000);
    } else {
      const error = await response.text();
      showStatusMessage(statusDiv, `Connection failed: ${response.status} - ${error}`, 'error', 5000);
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    showStatusMessage(statusDiv, `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', 5000);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

export function initSettingsModule() {
  loadSettings();
}
