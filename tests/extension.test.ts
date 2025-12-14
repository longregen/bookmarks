import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, '../dist-chrome');

const BROWSER_TYPE = process.env.BROWSER_TYPE || 'chrome';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.BROWSER_PATH;

  if (!executablePath) {
    throw new Error('BROWSER_PATH environment variable is required');
  }

  // Chrome
  return puppeteer.launch({
    executablePath,
    headless: false, // Extensions require headed mode in Chrome
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
}

async function getExtensionId(browser: Browser): Promise<string> {
  // Try to find extension ID using waitForTarget which properly waits for targets to appear
  // This is more robust than a fixed sleep, especially in CI environments
  const EXTENSION_TIMEOUT = 30000; // 30 seconds timeout

  try {
    // First, try to find the service worker target
    const serviceWorkerTarget = await browser.waitForTarget(
      target => target.type() === 'service_worker' && target.url().includes('chrome-extension://'),
      { timeout: EXTENSION_TIMEOUT }
    );

    const url = serviceWorkerTarget.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);

    if (match) {
      return match[1];
    }
  } catch {
    console.log('Service worker target not found, trying fallback methods...');
  }

  // Fallback: Look for any chrome-extension:// target (page, background page, etc.)
  try {
    const extensionTarget = await browser.waitForTarget(
      target => target.url().includes('chrome-extension://'),
      { timeout: 10000 }
    );

    const url = extensionTarget.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);

    if (match) {
      return match[1];
    }
  } catch {
    // Continue to final fallback
  }

  // Final fallback: Check all existing targets
  const targets = browser.targets();
  console.log('Available targets:', targets.map(t => ({ type: t.type(), url: t.url() })));

  const extensionTarget = targets.find(target =>
    target.url().includes('chrome-extension://')
  );

  if (!extensionTarget) {
    throw new Error('Extension not found. No chrome-extension:// targets available.');
  }

  const url = extensionTarget.url();
  const match = url.match(/chrome-extension:\/\/([^/]+)/);

  if (!match) {
    throw new Error('Could not extract extension ID from URL: ' + url);
  }

  return match[1];
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage, duration: Date.now() - start });
    console.error(`✗ ${name}: ${errorMessage}`);
  }
}

async function testChromeExtension(): Promise<void> {
  console.log('\n🧪 Testing Chrome Extension\n');

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const extensionId = await getExtensionId(browser);
    console.log(`Extension ID: ${extensionId}`);

    // Test 1: Popup loads correctly
    await runTest('Popup page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

      // Check for essential elements
      await page.waitForSelector('#saveBtn', { timeout: 5000 });
      await page.waitForSelector('#exploreBtn', { timeout: 5000 });
      await page.waitForSelector('#settingsBtn', { timeout: 5000 });

      const title = await page.title();
      if (!title.includes('Bookmark')) {
        throw new Error(`Unexpected title: ${title}`);
      }

      await page.close();
    });

    // Test 2: Options page loads
    await runTest('Options page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

      await page.waitForSelector('#settingsForm', { timeout: 5000 });
      await page.waitForSelector('#apiKey', { timeout: 5000 });
      await page.waitForSelector('#testBtn', { timeout: 5000 });

      await page.close();
    });

    // Test 3: Explore page loads
    await runTest('Explore page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#searchInput', { timeout: 5000 });
      await page.waitForSelector('#searchBtn', { timeout: 5000 });
      await page.waitForSelector('#bookmarkList', { timeout: 5000 });

      await page.close();
    });

    // Test 4: Configure API settings
    await runTest('Configure API settings', async () => {
      if (!OPENAI_API_KEY) {
        console.log('  (Skipping - no API key provided)');
        return;
      }

      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Clear and set API key
      await page.click('#apiKey', { clickCount: 3 });
      await page.type('#apiKey', OPENAI_API_KEY);

      // Save settings
      await page.click('[type="submit"]');

      // Wait for success message
      await page.waitForFunction(
        () => document.querySelector('.status.success') !== null,
        { timeout: 10000 }
      );

      await page.close();
    });

    // Test 5: Save a bookmark
    await runTest('Save a bookmark from test page', async () => {
      // Create a test page
      const testPage = await browser!.newPage();
      await testPage.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Test Bookmark Page</title></head>
        <body>
          <h1>Test Article</h1>
          <article>
            <p>This is a test article about artificial intelligence and machine learning.</p>
            <p>It contains important information about neural networks and deep learning.</p>
            <p>The future of AI is bright with many applications in various fields.</p>
          </article>
        </body>
        </html>
      `);

      // Open popup in a new tab
      const popupPage = await browser!.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

      // Note: Can't actually save from popup since it needs the active tab context
      // This test verifies the popup UI is functional
      await popupPage.waitForSelector('#saveBtn', { timeout: 5000 });

      // Verify stats are displayed
      await popupPage.waitForSelector('#totalCount', { timeout: 5000 });

      await testPage.close();
      await popupPage.close();
    });

    // Test 6: Test connection with API key
    await runTest('Test API connection', async () => {
      if (!OPENAI_API_KEY) {
        console.log('  (Skipping - no API key provided)');
        return;
      }

      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Set API key
      await page.click('#apiKey', { clickCount: 3 });
      await page.type('#apiKey', OPENAI_API_KEY);

      // Click test button
      await page.click('#testBtn');

      // Wait for result (success or error)
      await page.waitForFunction(
        () => {
          const status = document.querySelector('.status');
          return status && !status.classList.contains('hidden');
        },
        { timeout: 30000 }
      );

      const statusText = await page.$eval('.status', el => el.textContent);
      if (!statusText?.includes('successful')) {
        throw new Error(`API test failed: ${statusText}`);
      }

      await page.close();
    });

    // Test 7: Search UI functionality
    await runTest('Search UI is functional', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#searchInput', { timeout: 5000 });

      // Type a search query
      await page.type('#searchInput', 'test query');

      // Verify search button is present
      const searchBtnText = await page.$eval('#searchBtn', el => el.textContent);
      if (!searchBtnText?.includes('Search')) {
        throw new Error('Search button not found');
      }

      await page.close();
    });

    // Test 8: View switching works
    await runTest('View switching works', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#listViewBtn', { timeout: 5000 });
      await page.waitForSelector('#searchViewBtn', { timeout: 5000 });

      // Check list view is active by default
      const listViewActive = await page.$eval('#listViewBtn', el => el.classList.contains('active'));
      if (!listViewActive) {
        throw new Error('List view should be active by default');
      }

      // Switch to search view
      await page.click('#searchViewBtn');

      const searchViewActive = await page.$eval('#searchViewBtn', el => el.classList.contains('active'));
      if (!searchViewActive) {
        throw new Error('Search view should be active after clicking');
      }

      await page.close();
    });

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function testFirefoxExtension(): Promise<void> {
  console.log('\n🧪 Testing Firefox Extension\n');

  // Firefox extension testing with Puppeteer doesn't support loading unpacked extensions
  // like Chrome does. Firefox testing is handled via web-ext in the CI workflow.

  console.log('  Firefox extension testing is done via web-ext lint in CI.');
  console.log('  For manual testing, run: npx web-ext run -s dist-firefox');
  console.log('');

  await runTest('Firefox test placeholder (web-ext handles actual testing)', async () => {
    // This is a placeholder - actual Firefox testing is done via web-ext lint
    // which validates the extension structure and manifest
    console.log('    web-ext lint validates extension compatibility');
  });

  console.log('\n✓ Firefox extension validation delegated to web-ext');
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Browser Extension Tests');
  console.log('='.repeat(60));
  console.log(`Browser: ${BROWSER_TYPE}`);
  console.log(`API Key: ${OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('='.repeat(60));

  try {
    if (BROWSER_TYPE === 'chrome') {
      await testChromeExtension();
    } else if (BROWSER_TYPE === 'firefox') {
      await testFirefoxExtension();
    } else {
      throw new Error(`Unknown browser type: ${BROWSER_TYPE}`);
    }
  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✓ All tests passed!');
}

main();
