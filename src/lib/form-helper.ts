import { showStatusMessage } from './dom';

export interface FormConfig {
  formId: string;
  statusId: string;
  onLoad: () => Promise<void>;
  onSave: () => Promise<void>;
  saveButtonText?: { default: string; saving: string };
}

export function initSettingsForm(config: FormConfig): void {
  const form = document.getElementById(config.formId) as HTMLFormElement;
  const statusDiv = document.getElementById(config.statusId) as HTMLDivElement;

  config.onLoad().catch(error => {
    console.error('Error loading settings:', error);
    showStatusMessage(statusDiv, 'Failed to load settings', 'error', 5000);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
    const defaultText = config.saveButtonText?.default || 'Save';
    const savingText = config.saveButtonText?.saving || 'Saving...';

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = savingText;
      await config.onSave();
      showStatusMessage(statusDiv, 'Settings saved successfully!', 'success', 5000);
    } catch (error) {
      console.error('Error saving settings:', error);
      showStatusMessage(statusDiv, 'Failed to save settings', 'error', 5000);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = defaultText;
    }
  });
}
