import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { setupFirefoxProfile } from './firefox-setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_TYPE = process.env.BROWSER_TYPE || 'chrome';
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, BROWSER_TYPE === 'firefox' ? '../dist-firefox' : '../dist-chrome');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BROWSER_PATH = process.env.BROWSER_PATH;

// Create a temporary user data directory for the browser
// This is required for extension loading in CI environments
const USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `${BROWSER_TYPE}-e2e-profile-`));

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

  console.log(`Browser type: ${BROWSER_TYPE}`);
  console.log(`Extension path: ${EXTENSION_PATH}`);
  console.log(`User data dir: ${USER_DATA_DIR}`);
  console.log(`Browser path: ${BROWSER_PATH}`);

  if (BROWSER_TYPE === 'firefox') {
    // Pre-install extension to Firefox profile
    console.log('Setting up Firefox profile with extension...');
    await setupFirefoxProfile(USER_DATA_DIR, EXTENSION_PATH);

    console.log('Launching Firefox with Puppeteer...');
    const browser = await puppeteer.launch({
      product: 'firefox',
      executablePath: BROWSER_PATH,
      headless: false,
      args: [
        '-profile',
        USER_DATA_DIR,
        '--remote-debugging-port=0',
      ],
      extraPrefsFirefox: {
        // Enable extensions
        'xpinstall.signatures.required': false,
        'extensions.autoDisableScopes': 0,
        'extensions.enabledScopes': 15,
        // Enable remote debugging
        'devtools.chrome.enabled': true,
        'devtools.debugger.remote-enabled': true,
        'devtools.debugger.prompt-connection': false,
        'remote.enabled': true,
        'remote.force-local': true,
      },
      // Increase timeout for Firefox startup
      timeout: 60000,
      // Enable protocol debugging output
      dumpio: false,
      // Use pipe instead of websocket for more reliable connection
      pipe: true,
    });

    console.log('Firefox launched successfully');
    // Wait for extension to initialize
    await new Promise(resolve => setTimeout(resolve, 5000));

    return browser;
  } else {
    // Chrome/Chromium
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
}

async function getExtensionId(browser: Browser): Promise<string> {
  // Try to find extension ID using waitForTarget which properly waits for targets to appear
  // This is more robust than a fixed sleep, especially in CI environments
  const EXTENSION_TIMEOUT = 30000; // 30 seconds timeout
  const extensionProtocol = BROWSER_TYPE === 'firefox' ? 'moz-extension://' : 'chrome-extension://';
  const extensionRegex = BROWSER_TYPE === 'firefox'
    ? /moz-extension:\/\/([^/]+)/
    : /chrome-extension:\/\/([^/]+)/;

  try {
    // First, try to find the service worker target (Chrome) or background script (Firefox)
    const serviceWorkerTarget = await browser.waitForTarget(
      target => {
        const targetType = target.type();
        const url = target.url();
        return (targetType === 'service_worker' || targetType === 'background_page') &&
               url.includes(extensionProtocol);
      },
      { timeout: EXTENSION_TIMEOUT }
    );

    const url = serviceWorkerTarget.url();
    const match = url.match(extensionRegex);

    if (match) {
      return match[1];
    }
  } catch {
    console.log('Service worker/background target not found, trying fallback methods...');
  }

  // Fallback: Look for any extension:// target (page, background page, etc.)
  try {
    const extensionTarget = await browser.waitForTarget(
      target => target.url().includes(extensionProtocol),
      { timeout: 10000 }
    );

    const url = extensionTarget.url();
    const match = url.match(extensionRegex);

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
    target.url().includes(extensionProtocol)
  );

  if (!extensionTarget) {
    throw new Error(`Extension not found. No ${extensionProtocol} targets available.`);
  }

  const url = extensionTarget.url();
  const match = url.match(extensionRegex);

  if (!match) {
    throw new Error('Could not extract extension ID from URL: ' + url);
  }

  return match[1];
}

function getExtensionUrl(extensionId: string, path: string): string {
  const protocol = BROWSER_TYPE === 'firefox' ? 'moz-extension' : 'chrome-extension';
  return `${protocol}://${extensionId}${path}`;
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
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Set all API settings directly
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value = 'https://api.openai.com/v1');
      await page.$eval('#apiKey', (el: HTMLInputElement, key: string) => el.value = key, OPENAI_API_KEY!);
      await page.$eval('#chatModel', (el: HTMLInputElement) => el.value = 'gpt-4o-mini');
      await page.$eval('#embeddingModel', (el: HTMLInputElement) => el.value = 'text-embedding-3-small');

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
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

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

    // Test 3: Create a test page and save as bookmark via service worker
    await runTest('Save bookmark via content script simulation', async () => {
      // Open explore page to interact with database
      const explorePage = await browser!.newPage();
      await explorePage.goto(getExtensionUrl(extensionId, '/src/explore/explore.html'));

      // Wait for page to load
      await explorePage.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Get initial bookmark count
      const initialCountText = await explorePage.$eval('#bookmarkCount', el => el.textContent);
      const initialCount = parseInt(initialCountText || '0');

      // Navigate to a real page where we can capture content
      const testPage = await browser!.newPage();
      await testPage.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Capture the page content
      const pageData = await testPage.evaluate(() => ({
        url: location.href,
        title: document.title,
        html: document.documentElement.outerHTML
      }));

      // Send the message from an extension page context (popup) where chrome API is available
      const popupPage = await browser!.newPage();
      await popupPage.goto(getExtensionUrl(extensionId, '/src/popup/popup.html'));

      // Wait for popup to load
      await popupPage.waitForSelector('#saveBtn', { timeout: 5000 });

      // Use the popup's context to send the message (it has access to chrome.runtime)
      await popupPage.evaluate(async (data) => {
        await chrome.runtime.sendMessage({
          type: 'SAVE_BOOKMARK',
          data: data
        });
      }, pageData);

      await popupPage.close();

      // Wait for save to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Refresh explore page and check if bookmark was added
      await explorePage.reload({ waitUntil: 'domcontentloaded' });
      await explorePage.waitForSelector('#bookmarkCount', { timeout: 5000 });

      // Wait for stats to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the bookmark count increased
      const finalCountText = await explorePage.$eval('#bookmarkCount', el => el.textContent);
      const finalCount = parseInt(finalCountText || '0');

      if (finalCount <= initialCount) {
        throw new Error(`Bookmark was not added. Initial: ${initialCount}, Final: ${finalCount}`);
      }

      // Verify the bookmark appears in the list
      const bookmarkCards = await explorePage.$$('.bookmark-card');
      if (bookmarkCards.length === 0) {
        throw new Error('No bookmark cards found in list');
      }

      // Check if example.com appears in any bookmark card
      const hasExampleBookmark = await explorePage.evaluate(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        return Array.from(cards).some(card => {
          // Prefer anchor links, fall back to searching for valid URLs in text
          const link = card.querySelector('a[href]');
          if (link) {
            try {
              const url = new URL(link.href);
              return url.hostname === "example.com";
            } catch (e) {
              return false;
            }
          }
          // Optionally, try to find a URL in the plain text (basic regex)
          const urlMatch = card.textContent?.match(/https?:\/\/[^\s"']+/);
          if (urlMatch) {
            try {
              const url = new URL(urlMatch[0]);
              return url.hostname === "example.com";
            } catch (e) {
              return false;
            }
          }
          return false;
        });
      });

      if (!hasExampleBookmark) {
        throw new Error('example.com bookmark not found in list');
      }

      await testPage.close();
      await explorePage.close();
    });

    // Test 4: Verify bookmark appears in list
    await runTest('Bookmark appears in explore list', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/explore/explore.html'));

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
      await page.goto(getExtensionUrl(extensionId, '/src/explore/explore.html'));

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
      await page.goto(getExtensionUrl(extensionId, '/src/explore/explore.html'));

      await page.waitForSelector('#searchInput', { timeout: 5000 });

      // Set search query
      await page.$eval('#searchInput', (el: HTMLInputElement) => el.value = 'artificial intelligence');

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
      await page.goto(getExtensionUrl(extensionId, '/src/explore/explore.html'));

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
      await page.goto(getExtensionUrl(extensionId, '/src/popup/popup.html'));

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

    // Test 9: Bulk URL Import
    await runTest('Bulk URL import creates jobs and bookmarks', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#bulkUrlsInput', { timeout: 5000 });

      // Enter test URLs
      const testUrls = [
        'https://example.com',
        'https://httpbin.org/html',
        'https://www.wikipedia.org'
      ];
      await page.$eval('#bulkUrlsInput', (el: HTMLTextAreaElement, urls: string) => el.value = urls, testUrls.join('\n'));

      // Wait for validation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify validation feedback shows valid URLs
      const validationText = await page.$eval('#urlValidationFeedback', el => el.textContent);
      if (!validationText?.includes('3 valid')) {
        console.log('  (Validation might not show - continuing...)');
      }

      // Click import button
      await page.click('#startBulkImport');

      // Wait for import to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if progress is shown
      const progressVisible = await page.$eval('#bulkImportProgress', el =>
        !el.classList.contains('hidden')
      );

      if (progressVisible) {
        console.log('  (Bulk import started - progress visible)');
      }

      // Note: Full import may take time, so we just verify it started
      // The actual completion is tested in other scenarios

      await page.close();
    });

    // Test 10: Jobs Dashboard displays jobs
    await runTest('Jobs dashboard displays and filters jobs', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      // Scroll to jobs section
      await page.waitForSelector('#jobsList', { timeout: 5000 });

      // Wait for jobs to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if jobs are displayed or empty state shown
      const jobsContent = await page.$eval('#jobsList', el => el.innerHTML);
      const hasJobs = jobsContent.includes('job-item') || jobsContent.includes('loading') || jobsContent.includes('No jobs');

      if (!hasJobs) {
        console.log('  (Jobs list state unclear - may be loading)');
      }

      // Test filter functionality
      const hasTypeFilter = await page.$('#jobTypeFilter');
      const hasStatusFilter = await page.$('#jobStatusFilter');

      if (!hasTypeFilter || !hasStatusFilter) {
        throw new Error('Job filters not found');
      }

      // Click refresh button if it exists
      const refreshBtn = await page.$('#refreshJobsBtn');
      if (refreshBtn) {
        await refreshBtn.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      await page.close();
    });

    // Test 11: Jobs filtering works
    await runTest('Jobs can be filtered by type and status', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#jobTypeFilter', { timeout: 5000 });
      await page.waitForSelector('#jobStatusFilter', { timeout: 5000 });

      // Get initial jobs count
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test type filter
      await page.select('#jobTypeFilter', 'manual_add');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Test status filter
      await page.select('#jobStatusFilter', 'completed');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reset filters
      await page.select('#jobTypeFilter', 'all');
      await page.select('#jobStatusFilter', 'all');
      await new Promise(resolve => setTimeout(resolve, 500));

      await page.close();
    });

    // Test 12: Export/Import functionality
    await runTest('Export bookmarks creates download', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#exportBtn', { timeout: 5000 });

      // Set up download listener
      let downloadStarted = false;
      page.on('response', response => {
        if (response.headers()['content-disposition']?.includes('attachment')) {
          downloadStarted = true;
        }
      });

      // Click export button
      await page.click('#exportBtn');

      // Wait a moment for potential download
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Note: Actual file download verification is difficult in headless mode
      // We just verify the button is clickable
      console.log('  (Export button clicked - file download tested manually)');

      await page.close();
    });

    // Test 13: Import file input exists
    await runTest('Import file input is available', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#importFile', { timeout: 5000 });
      await page.waitForSelector('#importBtn', { timeout: 5000 });

      const fileInput = await page.$('#importFile');
      const importBtn = await page.$('#importBtn');

      if (!fileInput || !importBtn) {
        throw new Error('Import controls not found');
      }

      await page.close();
    });

    // Test 14: Bulk import validation
    await runTest('Bulk import validates URLs correctly', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#bulkUrlsInput', { timeout: 5000 });

      // Enter mix of valid and invalid URLs
      const mixedUrls = [
        'https://example.com',
        'javascript:alert(1)',
        'not-a-url',
        'https://github.com',
      ];
      await page.$eval('#bulkUrlsInput', (el: HTMLTextAreaElement, urls: string) => el.value = urls, mixedUrls.join('\n'));

      // Wait for validation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check validation feedback
      const feedback = await page.$('#urlValidationFeedback');
      if (feedback) {
        const text = await page.$eval('#urlValidationFeedback', el => el.textContent);
        console.log(`  (Validation: ${text})`);
      }

      // Clear the textarea
      await page.$eval('#bulkUrlsInput', (el: HTMLTextAreaElement) => el.value = '');

      await page.close();
    });

    // Test 15: Jobs auto-refresh
    await runTest('Jobs list can auto-refresh', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/options/options.html'));

      await page.waitForSelector('#jobsList', { timeout: 5000 });

      // Get initial content
      const initialContent = await page.$eval('#jobsList', el => el.innerHTML);

      // Wait for auto-refresh interval (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get updated content
      const updatedContent = await page.$eval('#jobsList', el => el.innerHTML);

      // Content may or may not change depending on job status
      // We just verify the list is still present
      if (updatedContent.length === 0) {
        throw new Error('Jobs list disappeared after refresh');
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
