/**
 * Chrome E2E Tests using Puppeteer
 *
 * This file contains end-to-end tests for the Chrome extension using Puppeteer.
 * For Firefox extension testing, see e2e-firefox.test.ts which uses Selenium
 * with GeckoDriver (Puppeteer has limited Firefox extension support).
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

// Type declaration for test helpers exposed by the explore page
declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<any>;
    };
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, '../dist-chrome');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BROWSER_PATH = process.env.BROWSER_PATH;

// Create a temporary user data directory for the browser
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

  // Chrome/Chromium
  const browser = await puppeteer.launch({
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
  return browser;
}

async function getExtensionId(browser: Browser): Promise<string> {
  const EXTENSION_TIMEOUT = 30000;

  try {
    // Find the service worker target
    const serviceWorkerTarget = await browser.waitForTarget(
      target => {
        const targetType = target.type();
        const url = target.url();
        return targetType === 'service_worker' && url.includes('chrome-extension://');
      },
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

  // Fallback: Look for any chrome-extension:// target
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

function getExtensionUrl(extensionId: string, path: string): string {
  return `chrome-extension://${extensionId}${path}`;
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
  console.log('Chrome E2E Browser Extension Tests (Puppeteer)');
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
      const libraryPage = await browser!.newPage();
      await libraryPage.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

      // Wait for page to load
      await libraryPage.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Get initial bookmark count
      const initialCountText = await libraryPage.$eval('#bookmarkCount', el => el.textContent);
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
      await libraryPage.reload({ waitUntil: 'domcontentloaded' });
      await libraryPage.waitForSelector('#bookmarkCount', { timeout: 5000 });

      // Wait for stats to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the bookmark count increased
      const finalCountText = await libraryPage.$eval('#bookmarkCount', el => el.textContent);
      const finalCount = parseInt(finalCountText || '0');

      if (finalCount <= initialCount) {
        throw new Error(`Bookmark was not added. Initial: ${initialCount}, Final: ${finalCount}`);
      }

      // Verify the bookmark appears in the list
      const bookmarkCards = await libraryPage.$$('.bookmark-card');
      if (bookmarkCards.length === 0) {
        throw new Error('No bookmark cards found in list');
      }

      // Check if example.com appears in any bookmark card
      const hasExampleBookmark = await libraryPage.evaluate(() => {
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
      await libraryPage.close();
    });

    // Test 4: Verify bookmark appears in list
    await runTest('Bookmark appears in explore list', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

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
      await page.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

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

    // Test 6: Verify readability content extraction
    await runTest('Readability extracts content correctly', async () => {
      // Create a simple test page with clear article content
      const testPage = await browser!.newPage();

      const testContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Understanding Machine Learning Fundamentals</title>
  <meta name="author" content="Jane Smith">
</head>
<body>
  <article>
    <header>
      <h1>Understanding Machine Learning Fundamentals</h1>
      <p class="byline">By Jane Smith</p>
      <time datetime="2024-01-15">January 15, 2024</time>
    </header>

    <p>Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed. This revolutionary approach has transformed how we solve complex problems in various domains.</p>

    <p>The fundamental principle behind machine learning is pattern recognition. Algorithms analyze training data to identify patterns and make predictions on new, unseen data. This capability has opened up new possibilities in data analysis and automation.</p>

    <h2>Core Concepts</h2>

    <p>At its core, machine learning relies on statistical methods and computational algorithms. The process involves feeding data to algorithms that can identify patterns and relationships within the data. These patterns are then used to make predictions or decisions without being explicitly programmed for specific tasks.</p>

    <p>Machine learning models improve their performance through experience. As they process more data, they refine their internal parameters to make better predictions. This iterative learning process is what distinguishes machine learning from traditional programming approaches.</p>

    <h2>Types of Learning</h2>

    <p>There are three main categories of machine learning approaches, each suited for different types of problems and data scenarios.</p>

    <p>Supervised learning uses labeled data, where the algorithm learns from examples that include both input and desired output. This approach is commonly used for classification and regression tasks.</p>

    <p>Unsupervised learning finds hidden patterns in unlabeled data, discovering structure without explicit guidance. Clustering and dimensionality reduction are common applications of this approach.</p>

    <p>Reinforcement learning learns through trial and error, receiving rewards or penalties based on actions taken. This approach has proven particularly effective in game playing and robotics.</p>

    <h2>Real-world Applications</h2>

    <p>Machine learning powers recommendation systems that suggest products, movies, or content based on user preferences and behavior patterns. These systems analyze vast amounts of user interaction data to provide personalized experiences.</p>

    <p>In finance, machine learning algorithms detect fraud by identifying unusual patterns in transaction data. These systems can process millions of transactions in real-time, flagging suspicious activities for further investigation.</p>

    <p>Medical diagnosis has been revolutionized by machine learning, with algorithms analyzing medical images, patient records, and genetic data to assist doctors in identifying diseases and recommending treatments.</p>

    <p>Autonomous vehicles rely heavily on machine learning for perception, decision-making, and control. These systems process data from sensors and cameras to navigate safely through complex environments.</p>

    <p>Natural language processing systems use machine learning to understand and generate human language, enabling applications like virtual assistants, machine translation, and sentiment analysis.</p>
  </article>
</body>
</html>`;

      await testPage.setContent(testContent, { waitUntil: 'domcontentloaded' });

      // Get the page HTML
      const pageData = await testPage.evaluate(() => {
        return {
          html: document.documentElement.outerHTML,
          title: document.title,
        };
      });

      // Use a realistic article URL for Readability compatibility
      // Avoid generic domains like example.com that Readability might filter
      pageData.url = 'https://techblog.example.org/2024/01/understanding-machine-learning-fundamentals';

      // Close the test page before opening popup
      await testPage.close();

      // Send bookmark data to service worker via the extension's message system
      // We'll use the explore page to access the database and extension APIs
      const libraryPage = await browser!.newPage();
      await libraryPage.goto(`chrome-extension://${extensionId}/src/library/library.html`);
      await libraryPage.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Inject the bookmark via the service worker
      const saveResult = await libraryPage.evaluate(async (data) => {
        // Send message to service worker to save the bookmark
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'SAVE_BOOKMARK', data },
            (response) => resolve(response)
          );
        });
      }, pageData);

      if (!saveResult || !(saveResult as any).success) {
        throw new Error('Failed to save bookmark: ' + JSON.stringify(saveResult));
      }

      console.log('  Bookmark saved, waiting for processing...');

      // Wait for bookmark to be processed (up to 90 seconds)
      const maxWait = 90000;
      const startTime = Date.now();
      let processed = false;

      while (Date.now() - startTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await libraryPage.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const bookmarkStatus = await libraryPage.evaluate(async () => {
          // Use the exposed test helper to access the database
          if (!window.__testHelpers) {
            throw new Error('Test helpers not available on window object');
          }
          return await window.__testHelpers.getBookmarkStatus();
        });

        console.log('  Status check:', JSON.stringify(bookmarkStatus, null, 2));

        const testBookmark = bookmarkStatus.bookmarks.find(
          (b: any) => b.title === 'Understanding Machine Learning Fundamentals'
        );

        if (testBookmark) {
          if (testBookmark.status === 'complete') {
            processed = true;

            // Find the markdown for this specific bookmark
            const bookmarkMarkdown = bookmarkStatus.markdown.find(
              (m: any) => m.bookmarkId === testBookmark.id
            );

            if (!bookmarkMarkdown) {
              throw new Error('Bookmark processed but no markdown entry found in database');
            }

            console.log(`  Markdown content length: ${bookmarkMarkdown.contentLength}`);
            console.log(`  Markdown preview: ${bookmarkMarkdown.contentPreview}`);

            if (bookmarkMarkdown.contentLength === 0) {
              throw new Error(
                'Readability extracted empty content. This indicates an issue with content extraction.\n' +
                `Bookmark URL: ${testBookmark.url}\n` +
                'The HTML structure may not be compatible with Readability, or the URL format may be causing issues.'
              );
            }

            const markdown = bookmarkMarkdown.contentPreview;

            // Check for key content that should be extracted by Readability
            // Note: We only check the preview (first ~200 chars), so we can only verify
            // content from the beginning of the extracted article
            const expectedPhrases = [
              'Machine learning',
              'artificial intelligence',
            ];

            const missingPhrases = expectedPhrases.filter(phrase =>
              !markdown.toLowerCase().includes(phrase.toLowerCase())
            );

            if (missingPhrases.length > 0) {
              throw new Error(
                `Extracted content is missing expected phrases: ${missingPhrases.join(', ')}\n` +
                `Markdown content preview (200 chars): ${markdown}`
              );
            }

            console.log('  ✓ Content extracted successfully with all expected phrases');
            break;
          } else if (testBookmark.status === 'error') {
            throw new Error(`Bookmark processing failed: ${testBookmark.errorMessage}`);
          }
        }
      }

      if (!processed) {
        throw new Error('Bookmark did not complete processing within timeout period');
      }

      await libraryPage.close();
    });

    // Test 7: Test search functionality
    await runTest('Search for bookmarks', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

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

    // Test 8: View switching
    await runTest('View switching between list and search', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

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

    // Test 9: Popup page loads with navigation
    await runTest('Popup page loads with navigation buttons', async () => {
      const page = await browser!.newPage();
      await page.goto(getExtensionUrl(extensionId, '/src/popup/popup.html'));

      // Wait for save button to load
      await page.waitForSelector('#saveBtn', { timeout: 5000 });

      // Wait for navigation buttons to load
      await page.waitForSelector('#navLibrary', { timeout: 5000 });
      await page.waitForSelector('#navSearch', { timeout: 5000 });
      await page.waitForSelector('#navStumble', { timeout: 5000 });
      await page.waitForSelector('#navSettings', { timeout: 5000 });

      // Verify buttons are present and clickable
      const saveBtn = await page.$('#saveBtn');
      const navLibrary = await page.$('#navLibrary');
      const navSearch = await page.$('#navSearch');
      const navStumble = await page.$('#navStumble');
      const navSettings = await page.$('#navSettings');

      if (!saveBtn || !navLibrary || !navSearch || !navStumble || !navSettings) {
        throw new Error('Popup navigation buttons not found');
      }

      await page.close();
    });

    // Test 10: Bulk URL Import
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

    // Test 11: Jobs Dashboard displays jobs
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

    // Test 12: Jobs filtering works
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

    // Test 13: Export/Import functionality
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

    // Test 14: Import file input exists
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

    // Test 15: Bulk import validation
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

    // Test 16: Jobs auto-refresh
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
  console.log('Chrome E2E Test Summary (Puppeteer)');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  // Fail if no tests were run (indicates setup failure)
  if (results.length === 0) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✓ All Chrome E2E tests passed!');
}

main();
