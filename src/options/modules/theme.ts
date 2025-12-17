import { onThemeChange, applyTheme, getTheme, setTheme, type Theme } from '../../shared/theme';
import { initExtension } from '../../ui/init-extension';
import { initWeb } from '../../web/init-web';

const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

async function loadTheme(): Promise<void> {
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

export function initThemeModule(): void {
  if (__IS_WEB__) {
    void initWeb();
  } else {
    void initExtension();
  }
  onThemeChange((theme) => applyTheme(theme));

  void loadTheme();
}
