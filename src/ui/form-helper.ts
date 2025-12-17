import { showStatusMessage } from './dom';

export interface FormConfig {
  formId: string;
  statusId: string;
  onLoad: () => Promise<void>;
  onSave: () => Promise<void>;
  saveButtonText?: { default: string; saving: string };
}

export async function withButtonState<T>(
  button: HTMLButtonElement,
  loadingText: string,
  asyncFn: () => Promise<T>
): Promise<T> {
  const originalText = button.textContent || '';

  try {
    button.disabled = true;
    button.textContent = loadingText;
    return await asyncFn();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

export function initSettingsForm(config: FormConfig): void {
  const form = document.getElementById(config.formId) as HTMLFormElement;
  const statusDiv = document.getElementById(config.statusId) as HTMLDivElement;

  config.onLoad().catch((error: unknown) => {
    console.error('Error loading settings:', error);
    showStatusMessage(statusDiv, 'Failed to load settings', 'error', 5000);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]');
    if (!submitBtn) return;
    const savingText = config.saveButtonText?.saving ?? 'Saving...';

    try {
      await withButtonState(submitBtn, savingText, async () => {
        await config.onSave();
      });
      showStatusMessage(statusDiv, 'Settings saved successfully!', 'success', 5000);
    } catch (error) {
      console.error('Error saving settings:', error);
      showStatusMessage(statusDiv, 'Failed to save settings', 'error', 5000);
    }
  });
}
