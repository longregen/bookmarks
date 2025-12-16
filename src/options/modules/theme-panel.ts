import { getTheme, setTheme, type Theme } from '../../shared/theme';

export function initializeThemePanel() {
  const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

  // Load current theme
  loadTheme();

  // Theme change handlers
  themeRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        await setTheme(target.value as Theme);
      }
    });
  });

  async function loadTheme() {
    const theme = await getTheme();
    const radio = document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`);
    if (radio) {
      radio.checked = true;
    }
  }
}
