/**
 * E2E Screenshot Tests for UI/UX Validation
 *
 * This script captures screenshots of various UI states to help identify
 * UI/UX issues in the browser extension.
 *
 * Usage:
 *   BROWSER_PATH=/path/to/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npx tsx tests/e2e-screenshots.test.ts
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ChromeAdapter } from './adapters/chrome-adapter';
import { PageHandle } from './e2e-shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.resolve(PROJECT_ROOT, 'screenshots/chrome');

async function ensureScreenshotsDir(): Promise<void> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

async function captureScreenshot(page: PageHandle, filename: string, fullPage = false): Promise<void> {
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot(filepath, { fullPage });
  console.log(`  📸 Captured: ${filename}`);
}

async function setTheme(page: PageHandle, theme: string): Promise<void> {
  await page.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function testNewUserOnboarding(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 1: New User Onboarding ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('options'));
  await page.waitForSelector('#apiKey');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 1. Initial state
  await captureScreenshot(page, '01-onboarding-initial.png', true);

  // 2. API config section focus
  await page.evaluate(`
    const apiSection = document.querySelector('#apiKey').closest('.settings-section');
    if (apiSection) {
      apiSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  `);
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '02-api-config-section.png');

  // 3. Fill in API settings
  await page.evaluate(`
    document.getElementById('apiBaseUrl').value = '${adapter.getMockApiUrl()}';
    document.getElementById('apiKey').value = 'mock-api-key';
    document.getElementById('chatModel').value = 'gpt-4o-mini';
    document.getElementById('embeddingModel').value = 'text-embedding-3-small';
  `);
  await captureScreenshot(page, '03-api-config-filled.png');

  // 4. Save settings
  await page.click('[type="submit"]');
  await page.waitForFunction(
    `document.querySelector('.status')?.textContent?.includes('success')`,
    10000
  );
  await captureScreenshot(page, '04-settings-saved.png');

  // 5. Test connection - capture button state
  await captureScreenshot(page, '05-before-test-connection.png');

  await page.click('#testBtn');
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '06-testing-connection.png');

  // Wait for test to complete
  await page.waitForFunction(
    `(() => {
      const status = document.querySelector('.test-connection-status');
      return status && !status.classList.contains('hidden') &&
             (status.textContent?.includes('successful') || status.textContent?.includes('failed'));
    })()`,
    30000
  );
  await captureScreenshot(page, '07-test-connection-feedback.png');

  await page.close();
}

async function testAddingBookmark(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 2: Adding a Bookmark ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('popup'));
  await page.waitForSelector('#saveBtn');
  await new Promise(resolve => setTimeout(resolve, 500));

  // 1. Initial popup state
  await captureScreenshot(page, '08-popup-initial.png');

  // 2. Simulate saving a bookmark
  const testUrl = 'https://example.com/test-article';
  const testTitle = 'Test Article for Screenshot';
  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>${testTitle}</title></head>
    <body>
      <h1>Test Article</h1>
      <p>This is test content for screenshot testing.</p>
    </body>
    </html>
  `;

  await page.evaluate(`
    chrome.runtime.sendMessage(
      {
        type: 'SAVE_BOOKMARK',
        data: {
          url: '${testUrl}',
          title: '${testTitle}',
          html: ${JSON.stringify(testHtml)}
        }
      },
      () => {}
    );
  `);

  await new Promise(resolve => setTimeout(resolve, 2000));
  await captureScreenshot(page, '09-popup-after-save.png');

  await page.close();

  // 3. Check library for the new bookmark
  const libraryPage = await adapter.newPage();
  await libraryPage.goto(adapter.getPageUrl('library'));
  await libraryPage.waitForSelector('#bookmarkList');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await captureScreenshot(libraryPage, '10-library-with-new-bookmark.png', true);
  await libraryPage.close();
}

async function testBackgroundJobs(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 3: Background Jobs ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('jobs'));
  await page.waitForSelector('#jobsList');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 1. Initial jobs page
  await captureScreenshot(page, '11-jobs-initial.png', true);

  // 2. Test filters
  await page.select('#jobTypeFilter', 'manual_add');
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '12-jobs-filtered-by-type.png', true);

  await page.select('#jobStatusFilter', 'completed');
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '13-jobs-filtered-by-status.png', true);

  // Reset filters
  await page.select('#jobTypeFilter', '');
  await page.select('#jobStatusFilter', '');
  await new Promise(resolve => setTimeout(resolve, 500));

  await page.close();
}

async function testAdvancedConfiguration(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 4: Advanced Configuration ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('options'));
  await page.waitForSelector('#apiKey');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Scroll to advanced section
  await page.evaluate(`
    const advancedHeading = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('Advanced'));
    if (advancedHeading) {
      advancedHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  `);
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 1. Default state
  await captureScreenshot(page, '14-advanced-config-default.png');

  // 2. Click "Show All Settings" button
  // Override window.confirm to auto-accept
  await page.evaluate(`window.confirm = () => true`);

  // Find and click button by text content
  await page.evaluate(`
    const buttons = Array.from(document.querySelectorAll('button'));
    const showAllBtn = buttons.find(btn => btn.textContent.includes('Show All Settings'));
    if (showAllBtn) {
      showAllBtn.click();
    }
  `);

  await new Promise(resolve => setTimeout(resolve, 1000));
  await captureScreenshot(page, '15-advanced-config-expanded.png', true);

  await page.close();
}

async function testScrollingBehavior(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 5: Scrolling Behavior ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('options'));
  await page.waitForSelector('.middle');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 1. Top of page
  await captureScreenshot(page, '16-options-scroll-top.png');

  // 2. Scroll middle container
  await page.evaluate(`
    (() => {
      const middle = document.querySelector('.middle');
      if (middle) {
        middle.scrollTo(0, 500);
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '17-options-scroll-middle.png');

  // 3. Scroll to bottom
  await page.evaluate(`
    (() => {
      const middle = document.querySelector('.middle');
      if (middle) {
        middle.scrollTo(0, middle.scrollHeight);
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 500));
  await captureScreenshot(page, '18-options-scroll-bottom.png');

  await page.close();
}

async function testMarkdownStyling(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 6: Markdown Styling ===');

  // First, add a bookmark with markdown content
  const savePage = await adapter.newPage();
  await savePage.goto(adapter.getPageUrl('popup'));
  await savePage.waitForSelector('#saveBtn');

  const markdownHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Markdown Test Article</title></head>
    <body>
      <article>
        <h1>Main Heading</h1>
        <p>This is a test article with various markdown elements.</p>
        <h2>Subheading</h2>
        <ul>
          <li>First item in list</li>
          <li>Second item in list</li>
          <li>Third item in list</li>
        </ul>
        <p>More paragraph content here.</p>
      </article>
    </body>
    </html>
  `;

  await savePage.evaluate(`
    chrome.runtime.sendMessage(
      {
        type: 'SAVE_BOOKMARK',
        data: {
          url: 'https://example.com/markdown-test',
          title: 'Markdown Test Article',
          html: ${JSON.stringify(markdownHtml)}
        }
      },
      () => {}
    );
  `);
  await new Promise(resolve => setTimeout(resolve, 3000));
  await savePage.close();

  // Now view in library and test themes
  const themes = ['light', 'dark', 'terminal', 'tufte'];

  for (const theme of themes) {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');
    await setTheme(page, theme);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the markdown test bookmark
    await page.evaluate(`
      const cards = document.querySelectorAll('.bookmark-card');
      for (const card of cards) {
        const title = card.querySelector('.card-title');
        if (title && title.textContent && title.textContent.includes('Markdown Test')) {
          card.click();
          break;
        }
      }
    `);
    await new Promise(resolve => setTimeout(resolve, 1000));

    await captureScreenshot(page, `19-markdown-${theme}-theme.png`, true);
    await page.close();
  }
}

async function testLinkColors(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 7: Link Colors ===');

  const themes = ['light', 'dark', 'terminal', 'tufte'];

  for (const theme of themes) {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#apiKey');
    await setTheme(page, theme);

    // Scroll to About section
    await page.evaluate(`
      const aboutHeading = Array.from(document.querySelectorAll('h2, h3')).find(h => h.textContent.includes('About'));
      if (aboutHeading) {
        aboutHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    `);
    await new Promise(resolve => setTimeout(resolve, 1000));

    await captureScreenshot(page, `23-links-${theme}-theme.png`);
    await page.close();
  }
}

async function testSearchSpinners(adapter: ChromeAdapter): Promise<void> {
  console.log('\n=== Scenario 8: Search Spinners ===');

  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('search'));
  await page.waitForSelector('#searchInput');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Configure API first
  const optionsPage = await adapter.newPage();
  await optionsPage.goto(adapter.getPageUrl('options'));
  await optionsPage.waitForSelector('#apiKey');
  await optionsPage.evaluate(`
    document.getElementById('apiBaseUrl').value = '${adapter.getMockApiUrl()}';
    document.getElementById('apiKey').value = 'mock-api-key';
  `);
  await optionsPage.click('[type="submit"]');
  await optionsPage.waitForFunction(
    `document.querySelector('.status')?.textContent?.includes('success')`,
    10000
  );
  await optionsPage.close();

  // Now trigger search to capture loading state
  await page.type('#searchInput', 'test query');
  await new Promise(resolve => setTimeout(resolve, 100));

  // Click the search button to actually trigger the search
  await page.click('#searchBtn');

  // Capture the loading state quickly (spinner should be visible)
  await captureScreenshot(page, '27-search-loading-state.png');

  await new Promise(resolve => setTimeout(resolve, 3000));
  await captureScreenshot(page, '28-search-completed-state.png');

  await page.close();
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('E2E Screenshot Tests for UI/UX Validation');
  console.log('='.repeat(60));

  await ensureScreenshotsDir();
  console.log(`\nScreenshots will be saved to: ${SCREENSHOTS_DIR}\n`);

  const adapter = new ChromeAdapter();

  try {
    await adapter.setup();
    console.log('Browser and extension loaded successfully');

    await testNewUserOnboarding(adapter);
    await testAddingBookmark(adapter);
    await testBackgroundJobs(adapter);
    await testAdvancedConfiguration(adapter);
    await testScrollingBehavior(adapter);
    await testMarkdownStyling(adapter);
    await testLinkColors(adapter);
    await testSearchSpinners(adapter);

    console.log('\n' + '='.repeat(60));
    console.log('All screenshots captured successfully!');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nError during screenshot tests:', error);
    process.exit(1);
  } finally {
    await adapter.teardown();
  }
}

main();
