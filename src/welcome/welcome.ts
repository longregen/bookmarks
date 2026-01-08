import { getElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';

const openSettingsBtn = getElement<HTMLButtonElement>('openSettingsBtn');
const skipBtn = getElement<HTMLButtonElement>('skipBtn');

openSettingsBtn.addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/options/options.html#api-config');
});

skipBtn.addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/library/library.html');
});

onThemeChange((theme) => applyTheme(theme));
