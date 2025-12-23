/**
 * E2E Tests for Theme Switching
 *
 * Tests the theme selection functionality in the options page, including:
 * - Switching between all 5 themes (Auto, Light, Dark, Terminal, Tufte)
 * - Verifying theme is applied via data-theme attribute
 * - Verifying theme persists after page reload
 * - Verifying correct radio button is selected after switching
 *
 * Usage:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npx tsx tests/e2e-theme.test.ts
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner } from './e2e-shared';

type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

const ALL_THEMES: Theme[] = ['auto', 'light', 'dark', 'terminal', 'tufte'];

async function runThemeTests(adapter: ChromeAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- THEME SWITCHING TESTS ---\n');

  await runner.runTest('Options page loads with theme selector', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#appearance');

    // Verify all 5 theme radio buttons exist
    for (const theme of ALL_THEMES) {
      const radioId = `#theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
      const hasRadio = await page.$(radioId);
      if (!hasRadio) {
        throw new Error(`Theme radio button not found: ${radioId}`);
      }
    }

    await page.close();
  });

  await runner.runTest('Default theme is Auto with no data-theme attribute', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeAuto');

    // Verify Auto radio is checked by default
    const autoChecked = await page.evaluate(`document.getElementById('themeAuto').checked`) as boolean;
    if (!autoChecked) {
      throw new Error('Auto theme should be checked by default');
    }

    // Verify no data-theme attribute (Auto removes the attribute)
    const hasDataTheme = await page.evaluate(`document.documentElement.hasAttribute('data-theme')`) as boolean;
    if (hasDataTheme) {
      throw new Error('Auto theme should not have data-theme attribute');
    }

    await page.close();
  });

  // Test switching to each theme and verifying application
  for (const theme of ['light', 'dark', 'terminal', 'tufte'] as const) {
    await runner.runTest(`Switch to ${theme} theme and verify application`, async () => {
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#themeAuto');

      // Click the theme radio button
      const radioId = `#theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
      await page.click(radioId);

      // Wait for theme to be applied
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify the radio button is checked
      const isChecked = await page.evaluate(
        `document.querySelector('${radioId}').checked`
      ) as boolean;
      if (!isChecked) {
        throw new Error(`${theme} radio button should be checked`);
      }

      // Verify data-theme attribute is set correctly
      const dataTheme = await page.evaluate(
        `document.documentElement.getAttribute('data-theme')`
      ) as string | null;
      if (dataTheme !== theme) {
        throw new Error(`Expected data-theme="${theme}", got "${dataTheme}"`);
      }

      await page.close();
    });
  }

  await runner.runTest('Switch back to Auto theme removes data-theme attribute', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeAuto');

    // First switch to dark theme
    await page.click('#themeDark');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify dark theme is applied
    let dataTheme = await page.evaluate(
      `document.documentElement.getAttribute('data-theme')`
    ) as string | null;
    if (dataTheme !== 'dark') {
      throw new Error(`Expected data-theme="dark", got "${dataTheme}"`);
    }

    // Switch back to auto
    await page.click('#themeAuto');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify data-theme attribute is removed
    const hasDataTheme = await page.evaluate(
      `document.documentElement.hasAttribute('data-theme')`
    ) as boolean;
    if (hasDataTheme) {
      throw new Error('Auto theme should remove data-theme attribute');
    }

    // Verify Auto radio is checked
    const autoChecked = await page.evaluate(
      `document.getElementById('themeAuto').checked`
    ) as boolean;
    if (!autoChecked) {
      throw new Error('Auto radio button should be checked');
    }

    await page.close();
  });

  // Test persistence for each theme
  for (const theme of ALL_THEMES) {
    await runner.runTest(`${theme} theme persists after page reload`, async () => {
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#themeAuto');

      // Select the theme
      const radioId = `#theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
      await page.click(radioId);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Reload the page
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#themeAuto');

      // Wait for theme module to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify the correct radio button is still checked
      const isChecked = await page.evaluate(
        `document.querySelector('${radioId}').checked`
      ) as boolean;
      if (!isChecked) {
        throw new Error(`${theme} radio button should still be checked after reload`);
      }

      // Verify data-theme attribute is correct
      if (theme === 'auto') {
        const hasDataTheme = await page.evaluate(
          `document.documentElement.hasAttribute('data-theme')`
        ) as boolean;
        if (hasDataTheme) {
          throw new Error('Auto theme should not have data-theme attribute after reload');
        }
      } else {
        const dataTheme = await page.evaluate(
          `document.documentElement.getAttribute('data-theme')`
        ) as string | null;
        if (dataTheme !== theme) {
          throw new Error(`Expected data-theme="${theme}" after reload, got "${dataTheme}"`);
        }
      }

      await page.close();
    });
  }

  await runner.runTest('Theme selection works across multiple rapid switches', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeAuto');

    // Rapidly switch through all themes
    for (const theme of ALL_THEMES) {
      const radioId = `#theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
      await page.click(radioId);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Wait a bit for all events to process
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify final theme (Tufte) is applied
    const isTufteChecked = await page.evaluate(
      `document.getElementById('themeTufte').checked`
    ) as boolean;
    if (!isTufteChecked) {
      throw new Error('Tufte radio button should be checked after rapid switches');
    }

    const dataTheme = await page.evaluate(
      `document.documentElement.getAttribute('data-theme')`
    ) as string | null;
    if (dataTheme !== 'tufte') {
      throw new Error(`Expected data-theme="tufte", got "${dataTheme}"`);
    }

    await page.close();
  });

  await runner.runTest('Theme is applied consistently across different pages', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeTerminal');

    // Set terminal theme
    await page.click('#themeTerminal');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Navigate to library page
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for theme to be initialized
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify terminal theme is applied on library page
    let dataTheme = await page.evaluate(
      `document.documentElement.getAttribute('data-theme')`
    ) as string | null;
    if (dataTheme !== 'terminal') {
      throw new Error(`Expected data-theme="terminal" on library page, got "${dataTheme}"`);
    }

    // Navigate to search page
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for theme to be initialized
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify terminal theme is still applied on search page
    dataTheme = await page.evaluate(
      `document.documentElement.getAttribute('data-theme')`
    ) as string | null;
    if (dataTheme !== 'terminal') {
      throw new Error(`Expected data-theme="terminal" on search page, got "${dataTheme}"`);
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Theme Switching E2E Tests');
  console.log('='.repeat(60));
  console.log(`Browser: ${process.env.BROWSER_PATH || 'Not specified'}`);
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    await runThemeTests(adapter, runner);
  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await adapter.teardown();
  }

  runner.printSummary('Theme Tests');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All theme E2E tests passed!');
}

main();
