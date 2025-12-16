import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, '../dist-chrome');

const BROWSER_TYPE = process.env.BROWSER_TYPE || 'chrome';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Create a temporary user data directory for Chrome
// This is required for extension loading in CI environments
const USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-test-profile-'));

// Cleanup function for user data directory
function cleanupUserDataDir() {
  try {
    if (fs.existsSync(USER_DATA_DIR)) {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Ensure cleanup on exit
process.on('exit', cleanupUserDataDir);
process.on('SIGINT', () => { cleanupUserDataDir(); process.exit(1); });
process.on('SIGTERM', () => { cleanupUserDataDir(); process.exit(1); });

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

  // Verify extension path exists
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension path does not exist: ${EXTENSION_PATH}`);
  }

  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Extension manifest not found: ${manifestPath}`);
  }

  console.log(`Extension path: ${EXTENSION_PATH}`);
  console.log(`User data dir: ${USER_DATA_DIR}`);
  console.log(`Browser path: ${executablePath}`);
  console.log(`Extension contents: ${fs.readdirSync(EXTENSION_PATH).join(', ')}`);

  // Chromium/Chrome - using a user data directory is required for extension loading in CI
  // Note: Google Chrome blocks --load-extension flag, so we must use Chromium
  return puppeteer.launch({
    executablePath,
    headless: 'shell', // Use new headless mode that supports extensions (Chrome 112+)
    args: [
      `--user-data-dir=${USER_DATA_DIR}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
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

      // Check for bottom navigation buttons
      await page.waitForSelector('#libraryBtn', { timeout: 5000 });
      await page.waitForSelector('#searchBtn', { timeout: 5000 });
      await page.waitForSelector('#stumbleBtn', { timeout: 5000 });
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

    // Test 3: Library page loads
    await runTest('Library page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/library/library.html`);

      await page.waitForSelector('#bookmarkList', { timeout: 5000 });
      await page.waitForSelector('#sortSelect', { timeout: 5000 });
      await page.waitForSelector('#bookmarkCount', { timeout: 5000 });

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

      // Set all API settings directly
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value = 'https://api.openai.com/v1');
      await page.$eval('#apiKey', (el: HTMLInputElement, key: string) => el.value = key, OPENAI_API_KEY);
      await page.$eval('#chatModel', (el: HTMLInputElement) => el.value = 'gpt-4o-mini');
      await page.$eval('#embeddingModel', (el: HTMLInputElement) => el.value = 'text-embedding-3-small');

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
      // Get initial bookmark count
      const popupPage = await browser!.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await popupPage.waitForSelector('#totalCount', { timeout: 5000 });
      const initialCountText = await popupPage.$eval('#totalCount', el => el.textContent);
      const initialCount = parseInt(initialCountText || '0', 10);
      await popupPage.close();

      // Send SAVE_BOOKMARK message from a page context
      const testUrl = 'https://example.com/test-article';
      const testTitle = 'Test Article About AI';
      const testHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>${testTitle}</title></head>
        <body>
          <h1>Test Article</h1>
          <article>
            <p>This is a test article about artificial intelligence and machine learning.</p>
            <p>It contains important information about neural networks and deep learning.</p>
          </article>
        </body>
        </html>
      `;

      const savePage = await browser!.newPage();
      await savePage.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

      const result = await savePage.evaluate(async (url, title, html) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'SAVE_BOOKMARK', data: { url, title, html } },
            (response) => resolve(response)
          );
        });
      }, testUrl, testTitle, testHtml);

      await savePage.close();

      // Verify the save was successful
      if (!(result as any).success) {
        throw new Error(`Failed to save bookmark: ${(result as any).error || 'Unknown error'}`);
      }

      // Verify bookmark was saved by checking updated count
      const verifyPage = await browser!.newPage();
      await verifyPage.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await verifyPage.waitForSelector('#totalCount', { timeout: 5000 });

      // Wait a bit for stats to update
      await new Promise(resolve => setTimeout(resolve, 500));

      const newCountText = await verifyPage.$eval('#totalCount', el => el.textContent);
      const newCount = parseInt(newCountText || '0', 10);

      if (newCount !== initialCount + 1) {
        throw new Error(`Expected count to increase by 1 (from ${initialCount} to ${initialCount + 1}), but got ${newCount}`);
      }

      // Verify bookmark appears in library page
      await verifyPage.goto(`chrome-extension://${extensionId}/src/library/library.html`);
      await verifyPage.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Wait for bookmarks to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      const bookmarkTitles = await verifyPage.$$eval('.library-bookmark-card__title',
        elements => elements.map(el => el.textContent?.trim())
      );

      if (!bookmarkTitles.includes(testTitle)) {
        throw new Error(`Saved bookmark "${testTitle}" not found in bookmark list. Found: ${bookmarkTitles.join(', ')}`);
      }

      await verifyPage.close();
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

      // Set API settings directly
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value = 'https://api.openai.com/v1');
      await page.$eval('#apiKey', (el: HTMLInputElement, key: string) => el.value = key, OPENAI_API_KEY);

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

    // Test 7: Search page loads
    await runTest('Search page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/search/search.html`);

      await page.waitForSelector('#searchInput', { timeout: 5000 });
      await page.waitForSelector('#searchBtn', { timeout: 5000 });
      await page.waitForSelector('#searchResults', { timeout: 5000 });
      await page.waitForSelector('#sortSelect', { timeout: 5000 });

      // Type a search query
      await page.type('#searchInput', 'test query');

      // Verify input has the test query
      const inputValue = await page.$eval('#searchInput', el => (el as HTMLInputElement).value);
      if (inputValue !== 'test query') {
        throw new Error('Search input value not set correctly');
      }

      await page.close();
    });

    // Test 8: Stumble page loads
    await runTest('Stumble page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/stumble/stumble.html`);

      await page.waitForSelector('#stumbleList', { timeout: 5000 });
      await page.waitForSelector('#shuffleButton', { timeout: 5000 });
      await page.waitForSelector('#stumbleCount', { timeout: 5000 });

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
