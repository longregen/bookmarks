import { getElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { openExtensionPage } from '../lib/tabs';

const openSettingsBtn = getElement<HTMLButtonElement>('openSettingsBtn');
const skipBtn = getElement<HTMLButtonElement>('skipBtn');

openSettingsBtn.addEventListener('click', () => {
  void openExtensionPage('src/options/options.html#api-config');
});

skipBtn.addEventListener('click', () => {
  void openExtensionPage('src/library/library.html');
});

onThemeChange((theme) => applyTheme(theme));
