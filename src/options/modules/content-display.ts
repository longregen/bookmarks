import { getSettings, saveSetting } from '../../lib/settings';
import { getElement } from '../../ui/dom';

async function loadContentDisplaySettings(): Promise<void> {
  const settings = await getSettings();
  const checkbox = getElement<HTMLInputElement>('loadExternalResources');
  checkbox.checked = settings.loadExternalResources;
}

async function handleToggle(event: Event): Promise<void> {
  const checkbox = event.target as HTMLInputElement;
  await saveSetting('loadExternalResources', checkbox.checked);
}

export function initContentDisplayModule(): void {
  const checkbox = getElement<HTMLInputElement>('loadExternalResources');
  checkbox.addEventListener('change', (e) => void handleToggle(e));
  void loadContentDisplaySettings();
}
