import { onThemeChange, applyTheme, getTheme, setTheme, type Theme } from '../../shared/theme';
import { initExtension } from '../../lib/init-extension';
import { initWeb } from '../../web/init-web';

// Theme selector
const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

async function loadTheme() {
  const theme = await getTheme();
  const radio = document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`);
  if (radio) {
    radio.checked = true;
  }
}

themeRadios.forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.checked) {
      await setTheme(target.value as Theme);
    }
  });
});

export function initThemeModule() {
  // Initialize platform (web or extension)
  if (__IS_WEB__) {
    initWeb();
  } else {
    initExtension();
  }
  onThemeChange((theme) => applyTheme(theme));

  // Load current theme
  loadTheme();
}
