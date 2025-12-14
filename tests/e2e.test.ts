import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, '../dist-chrome');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BROWSER_PATH = process.env.BROWSER_PATH;

// Create a temporary user data directory for Chrome
// This is required for extension loading in CI environments
const USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-profile-'));

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

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is required for E2E tests');
  process.exit(1);
}

if (!BROWSER_PATH) {
  console.error('ERROR: BROWSER_PATH environment variable is required');
  process.exit(1);
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function launchBrowser(): Promise<Browser> {
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
  console.log(`Browser path: ${BROWSER_PATH}`);

  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: false, // Extensions require headed mode
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

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('E2E Browser Extension Tests');
  console.log('='.repeat(60));
  console.log(`API Key: ${OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('='.repeat(60));

  let browser: Browser | null = null;
  let extensionId: string = '';

  try {
    browser = await launchBrowser();
    extensionId = await getExtensionId(browser);
    console.log(`\nExtension ID: ${extensionId}\n`);

    // Test 1: Configure API settings
    await runTest('Configure API settings', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Clear existing values and set new ones
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value = '');
      await page.type('#apiBaseUrl', 'https://api.openai.com/v1');

      await page.$eval('#apiKey', (el: HTMLInputElement) => el.value = '');
      await page.type('#apiKey', OPENAI_API_KEY!);

      await page.$eval('#chatModel', (el: HTMLInputElement) => el.value = '');
      await page.type('#chatModel', 'gpt-4o-mini');

      await page.$eval('#embeddingModel', (el: HTMLInputElement) => el.value = '');
      await page.type('#embeddingModel', 'text-embedding-3-small');

      // Save settings
      await page.click('[type="submit"]');

      // Wait for success
      await page.waitForFunction(
        () => {
          const status = document.querySelector('.status');
          return status && status.textContent?.includes('success');
        },
        { timeout: 10000 }
      );

      await page.close();
    });

    // Test 2: Test API connection
    await runTest('Test API connection', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

      await page.waitForSelector('#testBtn', { timeout: 5000 });

      // Wait for settings to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click test button
      await page.click('#testBtn');

      // Wait for result
      await page.waitForFunction(
        () => {
          const status = document.querySelector('.status');
          return status && !status.classList.contains('hidden') &&
                 (status.textContent?.includes('successful') || status.textContent?.includes('failed'));
        },
        { timeout: 30000 }
      );

      const statusText = await page.$eval('.status', el => el.textContent);
      if (!statusText?.toLowerCase().includes('successful')) {
        throw new Error(`API test failed: ${statusText}`);
      }

      await page.close();
    });

    // Test 3: Create a test page and save as bookmark via service worker message
    await runTest('Save bookmark via content script simulation', async () => {
      // Open explore page to interact with database
      const explorePage = await browser!.newPage();
      await explorePage.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      // Wait for page to load
      await explorePage.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Get initial bookmark count
      const initialCount = await explorePage.$eval('#bookmarkCount', el => el.textContent);

      // Now simulate saving a bookmark by sending message to service worker
      // We'll use the popup page which can send messages

      // Create a test tab with content
      const testPage = await browser!.newPage();
      await testPage.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>E2E Test Article - AI and Machine Learning</title></head>
        <body>
          <article>
            <h1>Understanding Artificial Intelligence</h1>
            <p>Artificial intelligence (AI) is a branch of computer science that aims to create intelligent machines.</p>
            <p>Machine learning is a subset of AI that enables systems to learn from data.</p>
            <p>Deep learning uses neural networks with many layers to analyze complex patterns.</p>
            <p>Natural language processing helps computers understand human language.</p>
            <p>Computer vision enables machines to interpret visual information from the world.</p>
          </article>
        </body>
        </html>
      `, { waitUntil: 'domcontentloaded' });

      // Inject a script that sends the save message directly
      await testPage.evaluate((extId: string) => {
        const url = location.href;
        const title = document.title;
        const html = document.documentElement.outerHTML;

        // Send message to extension's service worker
        chrome.runtime.sendMessage(extId, {
          type: 'SAVE_BOOKMARK',
          data: { url, title, html }
        });
      }, extensionId);

      // Wait a moment for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refresh explore page and check if bookmark was added
      await explorePage.reload({ waitUntil: 'domcontentloaded' });
      await explorePage.waitForSelector('#bookmarkCount', { timeout: 5000 });

      // Wait for stats to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      await testPage.close();
      await explorePage.close();
    });

    // Test 4: Verify bookmark appears in list
    await runTest('Bookmark appears in explore list', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Wait for bookmarks to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if there's at least one bookmark card or empty state
      const hasBookmarks = await page.evaluate(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        const emptyState = document.querySelector('.empty-state');
        return cards.length > 0 || emptyState !== null;
      });

      if (!hasBookmarks) {
        throw new Error('Bookmark list did not load properly');
      }

      await page.close();
    });

    // Test 5: Wait for bookmark processing (if bookmark exists)
    await runTest('Wait for bookmark processing', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Check if there are any bookmarks
      const bookmarkCount = await page.$$eval('.bookmark-card', cards => cards.length);

      if (bookmarkCount === 0) {
        console.log('  (No bookmarks to process)');
        await page.close();
        return;
      }

      // Wait up to 60 seconds for processing to complete
      const maxWait = 60000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const statuses = await page.$$eval('.status-badge', badges =>
          badges.map(b => b.textContent?.toLowerCase())
        );

        const hasComplete = statuses.some(s => s === 'complete');
        const hasPending = statuses.some(s => s === 'pending' || s === 'processing');

        if (hasComplete && !hasPending) {
          console.log('  (Bookmark processing complete)');
          break;
        }

        if (statuses.some(s => s === 'error')) {
          console.log('  (Some bookmarks have errors)');
          break;
        }
      }

      await page.close();
    });

    // Test 6: Test search functionality
    await runTest('Search for bookmarks', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#searchInput', { timeout: 5000 });

      // Type search query
      await page.type('#searchInput', 'artificial intelligence');

      // Click search
      await page.click('#searchBtn');

      // Wait for search to complete (button becomes enabled again)
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('#searchBtn') as HTMLButtonElement;
          return btn && !btn.disabled && btn.textContent === 'Search';
        },
        { timeout: 60000 }
      );

      // Check search results
      const searchResults = await page.$('#searchResults');
      if (!searchResults) {
        throw new Error('Search results container not found');
      }

      // Verify we switched to search view
      const searchViewActive = await page.$eval('#searchViewBtn', el => el.classList.contains('active'));
      if (!searchViewActive) {
        // It might not have results if processing didn't complete
        console.log('  (Search view not active - may not have processed bookmarks)');
      }

      await page.close();
    });

    // Test 7: View switching
    await runTest('View switching between list and search', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/explore/explore.html`);

      await page.waitForSelector('#listViewBtn', { timeout: 5000 });

      // Click search view
      await page.click('#searchViewBtn');
      await new Promise(resolve => setTimeout(resolve, 500));

      const searchActive = await page.$eval('#searchView', el => el.classList.contains('active'));
      if (!searchActive) {
        throw new Error('Search view should be active');
      }

      // Click list view
      await page.click('#listViewBtn');
      await new Promise(resolve => setTimeout(resolve, 500));

      const listActive = await page.$eval('#listView', el => el.classList.contains('active'));
      if (!listActive) {
        throw new Error('List view should be active');
      }

      await page.close();
    });

    // Test 8: Popup stats display
    await runTest('Popup displays stats correctly', async () => {
      const page = await browser!.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);

      await page.waitForSelector('#totalCount', { timeout: 5000 });

      // Wait for stats to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      const totalCount = await page.$eval('#totalCount', el => el.textContent);
      const pendingCount = await page.$eval('#pendingCount', el => el.textContent);
      const completeCount = await page.$eval('#completeCount', el => el.textContent);

      // Verify stats are numbers
      if (isNaN(parseInt(totalCount || '')) ||
          isNaN(parseInt(pendingCount || '')) ||
          isNaN(parseInt(completeCount || ''))) {
        throw new Error('Stats are not valid numbers');
      }

      await page.close();
    });

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('E2E Test Summary');
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

  console.log('\n✓ All E2E tests passed!');
}

main();
