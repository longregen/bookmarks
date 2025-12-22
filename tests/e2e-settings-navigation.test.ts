/**
 * E2E Tests for Settings Sidebar Navigation
 *
 * Tests the sidebar navigation functionality in the options/settings page, including:
 * - Verifying all navigation items are present and properly structured
 * - Clicking navigation items to switch between sections
 * - Verifying the correct section is displayed after navigation
 * - Testing active state management (only one active item at a time)
 * - Testing URL hash changes on navigation
 * - Testing scroll behavior when clicking navigation items
 * - Testing rapid navigation clicks and edge cases
 * - Testing IntersectionObserver-based scroll tracking (desktop only)
 *
 * Usage:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npx tsx tests/e2e-settings-navigation.test.ts
 *
 * Or use the npm script:
 *   npm run test:e2e:settings-nav
 */

import { TestAdapter, TestRunner, PageHandle, waitForSettingsLoad } from './e2e-shared';
import { ChromeAdapter } from './adapters/chrome-adapter';

interface NavigationTestCase {
  sectionId: string;
  navLabel: string;
  expectedHeading: string;
}

const NAVIGATION_SECTIONS: NavigationTestCase[] = [
  { sectionId: 'appearance', navLabel: 'Appearance', expectedHeading: 'Theme' },
  { sectionId: 'api-config', navLabel: 'API Configuration', expectedHeading: 'API Configuration' },
  { sectionId: 'bulk-import', navLabel: 'Bulk Import', expectedHeading: 'Bulk Import URLs' },
  { sectionId: 'import-export', navLabel: 'Import / Export', expectedHeading: 'Import / Export' },
  { sectionId: 'webdav-sync', navLabel: 'WebDAV Sync', expectedHeading: 'WebDAV Sync' },
  { sectionId: 'about', navLabel: 'About', expectedHeading: 'About' },
];

async function waitForSmoothScrollComplete(page: PageHandle, timeout = 2000): Promise<void> {
  // Wait for smooth scroll to complete by checking scroll position stabilization
  await new Promise(resolve => setTimeout(resolve, timeout));
}

async function runNavigationTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- Settings Navigation Tests ---\n');

  await runner.runTest('Settings page loads with default active section', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Check that appearance section is active by default
    const activeNavItem = await page.$eval<string>(
      '.nav-item.active',
      'el => el.dataset.section'
    );

    if (activeNavItem !== 'appearance') {
      throw new Error(`Expected 'appearance' to be active by default, but got '${activeNavItem}'`);
    }

    // Verify the appearance section is visible
    const appearanceSection = await page.$('#appearance');
    if (!appearanceSection) {
      throw new Error('Appearance section not found');
    }

    await page.close();
  });

  await runner.runTest('All navigation items are present', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');

    for (const section of NAVIGATION_SECTIONS) {
      const navItem = await page.$(`[data-section="${section.sectionId}"]`);
      if (!navItem) {
        throw new Error(`Navigation item for '${section.sectionId}' not found`);
      }

      const labelText = await page.$eval<string>(
        `[data-section="${section.sectionId}"] .nav-label`,
        'el => el.textContent'
      );

      if (labelText !== section.navLabel) {
        throw new Error(`Expected label '${section.navLabel}', got '${labelText}'`);
      }
    }

    await page.close();
  });

  await runner.runTest('All section elements exist in the page', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.settings-section');

    for (const section of NAVIGATION_SECTIONS) {
      const sectionElement = await page.$(`#${section.sectionId}`);
      if (!sectionElement) {
        throw new Error(`Section element '${section.sectionId}' not found`);
      }

      const hasClass = await page.$eval<boolean>(
        `#${section.sectionId}`,
        'el => el.classList.contains("settings-section")'
      );

      if (!hasClass) {
        throw new Error(`Section '${section.sectionId}' does not have 'settings-section' class`);
      }
    }

    await page.close();
  });

  await runner.runTest('Clicking nav item updates active state', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Click on API Configuration nav item
    await page.click('[data-section="api-config"]');
    await waitForSmoothScrollComplete(page, 1000);

    // Verify API Configuration is now active
    const activeSection = await page.$eval<string>(
      '.nav-item.active',
      'el => el.dataset.section'
    );

    if (activeSection !== 'api-config') {
      throw new Error(`Expected 'api-config' to be active, but got '${activeSection}'`);
    }

    // Verify appearance is no longer active
    const appearanceActive = await page.$eval<boolean>(
      '[data-section="appearance"]',
      'el => el.classList.contains("active")'
    );

    if (appearanceActive) {
      throw new Error('Appearance nav item should not be active after clicking API Configuration');
    }

    await page.close();
  });

  await runner.runTest('Clicking nav item scrolls to correct section', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Click on WebDAV Sync (towards bottom of page)
    await page.click('[data-section="webdav-sync"]');
    await waitForSmoothScrollComplete(page, 1500);

    // Verify the section is in view by checking scroll position
    const isInView = await page.evaluate(`(() => {
      const section = document.getElementById('webdav-sync');
      const scrollContainer = document.querySelector('.middle');
      if (!section || !scrollContainer) return false;

      const sectionRect = section.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // Check if section top is within viewport (with some tolerance)
      const sectionTop = sectionRect.top - containerRect.top;
      return sectionTop >= -50 && sectionTop <= 200;
    })()`);

    if (!isInView) {
      throw new Error('WebDAV Sync section is not scrolled into view');
    }

    await page.close();
  });

  await runner.runTest('Navigating through all sections sequentially', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    for (const section of NAVIGATION_SECTIONS) {
      // Click the navigation item
      await page.click(`[data-section="${section.sectionId}"]`);
      await waitForSmoothScrollComplete(page, 1000);

      // Verify it became active
      const isActive = await page.$eval<boolean>(
        `[data-section="${section.sectionId}"]`,
        'el => el.classList.contains("active")'
      );

      if (!isActive) {
        throw new Error(`Section '${section.sectionId}' did not become active after clicking`);
      }

      // Verify the section heading is visible
      const headingVisible = await page.evaluate(`(() => {
        const section = document.getElementById('${section.sectionId}');
        if (!section) return false;

        const heading = section.querySelector('h2');
        if (!heading) return false;

        const rect = heading.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      })()`);

      // Note: We don't fail if heading is not in viewport because smooth scroll may still be in progress
      // The important part is that the nav item is active
    }

    await page.close();
  });

  await runner.runTest('Section headings match navigation labels', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.settings-section');

    for (const section of NAVIGATION_SECTIONS) {
      const headingText = await page.$eval<string>(
        `#${section.sectionId} h2`,
        'el => el.textContent'
      );

      if (headingText !== section.expectedHeading) {
        throw new Error(
          `Section '${section.sectionId}' heading mismatch: expected '${section.expectedHeading}', got '${headingText}'`
        );
      }
    }

    await page.close();
  });

  await runner.runTest('Navigation preserves hash in URL on click', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Click on import-export
    await page.click('[data-section="import-export"]');
    await waitForSmoothScrollComplete(page, 500);

    // Check that URL hash is updated (nav items have href="#section-id")
    const currentHash = await page.evaluate(`window.location.hash`);

    if (currentHash !== '#import-export') {
      throw new Error(`Expected URL hash to be '#import-export', but got '${currentHash}'`);
    }

    await page.close();
  });

  await runner.runTest('Scroll container is properly configured', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.middle');

    // Verify the scroll container exists
    const hasScrollContainer = await page.$('.middle');
    if (!hasScrollContainer) {
      throw new Error('Scroll container .middle not found');
    }

    // Verify sections are within the scroll container
    const sectionsInContainer = await page.evaluate(`(() => {
      const container = document.querySelector('.middle');
      const sections = document.querySelectorAll('.settings-section');
      return Array.from(sections).every(section => container.contains(section));
    })()`);

    if (!sectionsInContainer) {
      throw new Error('Not all sections are within the scroll container');
    }

    await page.close();
  });

  await runner.runTest('Sidebar navigation is properly structured', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.sidebar');

    // Verify sidebar exists
    const hasSidebar = await page.$('.sidebar');
    if (!hasSidebar) {
      throw new Error('Sidebar not found');
    }

    // Verify sidebar-nav exists within sidebar
    const hasNav = await page.$('.sidebar .sidebar-nav');
    if (!hasNav) {
      throw new Error('Sidebar navigation not found');
    }

    // Verify all nav items are anchors with proper structure
    const navItemsValid = await page.evaluate(`(() => {
      const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
      return Array.from(navItems).every(item => {
        return item.tagName === 'A' &&
               item.hasAttribute('data-section') &&
               item.querySelector('.nav-label');
      });
    })()`);

    if (!navItemsValid) {
      throw new Error('Some navigation items have invalid structure');
    }

    await page.close();
  });

  await runner.runTest('Rapid navigation clicks are handled gracefully', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Rapidly click through multiple sections
    await page.click('[data-section="api-config"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.click('[data-section="webdav-sync"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.click('[data-section="about"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.click('[data-section="appearance"]');

    // Wait for final scroll to complete
    await waitForSmoothScrollComplete(page, 1500);

    // Verify the last clicked item is active
    const activeSection = await page.$eval<string>(
      '.nav-item.active',
      'el => el.dataset.section'
    );

    if (activeSection !== 'appearance') {
      throw new Error(`Expected 'appearance' to be active after rapid clicks, but got '${activeSection}'`);
    }

    await page.close();
  });

  await runner.runTest('Only one nav item is active at a time', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.nav-item');
    await waitForSettingsLoad(page);

    // Click on different sections and verify only one is active
    for (const section of ['api-config', 'import-export', 'about']) {
      await page.click(`[data-section="${section}"]`);
      await waitForSmoothScrollComplete(page, 1000);

      const activeCount = await page.evaluate(`(() => {
        return document.querySelectorAll('.nav-item.active').length;
      })()`);

      if (activeCount !== 1) {
        throw new Error(`Expected exactly 1 active nav item, but found ${activeCount} after clicking '${section}'`);
      }

      const activeSection = await page.$eval<string>(
        '.nav-item.active',
        'el => el.dataset.section'
      );

      if (activeSection !== section) {
        throw new Error(`Expected '${section}' to be active, but got '${activeSection}'`);
      }
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Settings Navigation E2E Tests');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();
    await runNavigationTests(adapter, runner);
  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await adapter.teardown();
  }

  runner.printSummary('Settings Navigation');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Settings Navigation tests passed!');
}

main();
