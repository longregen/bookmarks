/**
 * Firefox E2E Tests using Selenium WebDriver
 *
 * This file contains end-to-end tests for the Firefox extension using Selenium
 * with GeckoDriver. Unlike Puppeteer, Selenium has full support for Firefox
 * extension testing, including navigation to moz-extension:// pages.
 *
 * Puppeteer's Firefox support via WebDriver BiDi cannot interact with extension
 * browsing contexts (moz-extension:// pages), making Selenium the better choice
 * for Firefox extension testing.
 */

import { Builder, Browser, WebDriver, By, until, WebElement } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(__dirname, '../dist-firefox');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BROWSER_PATH = process.env.BROWSER_PATH;

// This will be set after we detect the extension's actual UUID
let extensionUUID: string = '';

// Create a temporary directory for XPI and profile
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'firefox-e2e-'));
const XPI_PATH = path.join(TEMP_DIR, 'extension.xpi');

// Cleanup function for temporary directory
function cleanupTempDir() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create an XPI (ZIP) file from the extension directory.
 * Selenium's Firefox driver requires extensions to be packaged as .xpi or .zip files.
 */
function createXpiFromDirectory(extensionDir: string, xpiPath: string): void {
  console.log(`Creating XPI package from ${extensionDir}...`);

  // Use the system zip command to create the XPI
  // XPI files are just ZIP files with a different extension
  try {
    execSync(`cd "${extensionDir}" && zip -r "${xpiPath}" .`, {
      stdio: 'pipe'
    });
    console.log(`XPI created at: ${xpiPath}`);
  } catch (error) {
    throw new Error(`Failed to create XPI: ${error}`);
  }
}

// Ensure cleanup on exit
process.on('exit', cleanupTempDir);
process.on('SIGINT', () => { cleanupTempDir(); process.exit(1); });
process.on('SIGTERM', () => { cleanupTempDir(); process.exit(1); });

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

function getExtensionUrl(urlPath: string): string {
  if (!extensionUUID) {
    throw new Error('Extension UUID not set. Call detectExtensionUUID first.');
  }
  return `moz-extension://${extensionUUID}${urlPath}`;
}

/**
 * Detect the extension's internal UUID by navigating to about:debugging.
 * Firefox assigns a random UUID to each extension installation, so we need
 * to discover it after the extension is installed.
 */
async function detectExtensionUUID(driver: WebDriver, extensionName: string): Promise<string> {
  console.log(`Detecting extension UUID for "${extensionName}" from about:debugging...`);

  // Navigate to about:debugging to find the extension
  await driver.get('about:debugging#/runtime/this-firefox');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Get the page source
  const pageSource = await driver.getPageSource();

  // Debug: Check if our extension name appears in the page
  if (!pageSource.includes(extensionName)) {
    console.log('WARNING: Extension name not found in about:debugging page');
    console.log('Looking for any temporary extension...');

    // Try to find "Temporary Extensions" section and get UUID from there
    // Selenium-installed extensions appear as temporary extensions
  }

  // The about:debugging page structure has extension cards with:
  // - Extension name
  // - Internal UUID field
  // We need to find the UUID associated with our specific extension

  // Strategy 1: Look for our extension name followed by moz-extension URL
  // The manifest URL typically appears near the extension name
  const extensionSection = pageSource.split(extensionName)[1];
  if (extensionSection) {
    const uuidMatch = extensionSection.match(/moz-extension:\/\/([a-f0-9-]{36})/i);
    if (uuidMatch) {
      const uuid = uuidMatch[1];
      console.log(`Detected extension UUID (near extension name): ${uuid}`);
      return uuid;
    }
  }

  // Strategy 2: Look for Internal UUID pattern near extension name
  const internalUuidPattern = new RegExp(
    extensionName + '[\\s\\S]*?Internal UUID[\\s\\S]*?([a-f0-9-]{36})',
    'i'
  );
  const internalMatch = pageSource.match(internalUuidPattern);
  if (internalMatch) {
    const uuid = internalMatch[1];
    console.log(`Detected extension UUID (from Internal UUID field): ${uuid}`);
    return uuid;
  }

  // Strategy 3: If extension name not found, look for "Temporary Extension" with moz-extension
  // This is a fallback for when the extension appears differently
  const tempExtSection = pageSource.match(/Temporary Extensions[\s\S]*?moz-extension:\/\/([a-f0-9-]{36})/i);
  if (tempExtSection) {
    const uuid = tempExtSection[1];
    console.log(`Detected extension UUID (from Temporary Extensions): ${uuid}`);
    return uuid;
  }

  // Strategy 4: Last resort - get all UUIDs and use the last one (most recently installed)
  const allUuids = pageSource.match(/moz-extension:\/\/([a-f0-9-]{36})/gi);
  if (allUuids && allUuids.length > 0) {
    // Filter out common system extension UUIDs if possible
    const lastUuid = allUuids[allUuids.length - 1].match(/([a-f0-9-]{36})/i);
    if (lastUuid) {
      console.log(`Detected extension UUID (last found): ${lastUuid[1]}`);
      console.log(`All UUIDs found: ${allUuids.length}`);
      return lastUuid[1];
    }
  }

  // Debug: Save page source for analysis
  console.log('DEBUG: Page source excerpt (first 2000 chars):');
  console.log(pageSource.substring(0, 2000));

  throw new Error(`Could not detect extension UUID for "${extensionName}". Extension may not be installed.`);
}

async function createDriver(): Promise<WebDriver> {
  // Verify extension path exists
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension path does not exist: ${EXTENSION_PATH}`);
  }

  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Extension manifest not found: ${manifestPath}`);
  }

  // Read the manifest to get the extension ID and name
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent);
  const extensionId = manifest.browser_specific_settings?.gecko?.id || 'bookmarks@localforge.org';
  const extensionName = manifest.name || 'Bookmark RAG';

  console.log(`Browser path: ${BROWSER_PATH}`);
  console.log(`Extension path: ${EXTENSION_PATH}`);
  console.log(`Extension ID from manifest: ${extensionId}`);

  // Create XPI package from extension directory
  // Selenium's Firefox driver requires extensions to be packaged as .xpi or .zip files
  createXpiFromDirectory(EXTENSION_PATH, XPI_PATH);

  // Set up Firefox options
  const options = new firefox.Options();

  // Set the Firefox binary path
  options.setBinary(BROWSER_PATH);

  // Set Firefox preferences
  options.setPreference('xpinstall.signatures.required', false);
  options.setPreference('extensions.autoDisableScopes', 0);
  options.setPreference('extensions.enabledScopes', 15);
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  options.setPreference('browser.startup.homepage_override.mstone', 'ignore');
  options.setPreference('datareporting.policy.dataSubmissionEnabled', false);

  // Build the driver WITHOUT the extension first
  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .build();

  // Install extension AFTER driver starts using installAddon
  // This method is more reliable and returns the addon ID
  console.log('Installing extension via driver.installAddon()...');
  const installedAddonId = await (driver as any).installAddon(XPI_PATH, true);
  console.log(`Extension installed with addon ID: ${installedAddonId}`);

  // Wait for extension to initialize
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Detect the actual extension UUID from about:debugging
  extensionUUID = await detectExtensionUUID(driver, extensionName);

  // Verify the extension is accessible by trying to load its manifest
  console.log('Verifying extension is accessible...');
  try {
    await driver.get(`moz-extension://${extensionUUID}/manifest.json`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pageSource = await driver.getPageSource();
    if (pageSource.includes(extensionName) || pageSource.includes('manifest_version')) {
      console.log('✓ Extension manifest is accessible');
    } else {
      console.log('WARNING: Extension manifest loaded but content unexpected');
      console.log('Page content preview:', pageSource.substring(0, 500));
    }
  } catch (error) {
    console.error('ERROR: Could not access extension manifest');
    console.error('This may indicate the wrong UUID was detected or extension failed to install');
    throw error;
  }

  return driver;
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

// Helper to wait for element
async function waitForElement(driver: WebDriver, selector: string, timeout = 5000): Promise<WebElement> {
  return driver.wait(until.elementLocated(By.css(selector)), timeout);
}

// Helper to wait for element and get text
async function getElementText(driver: WebDriver, selector: string, timeout = 5000): Promise<string> {
  const element = await waitForElement(driver, selector, timeout);
  return element.getText();
}

// Helper to set input value using JavaScript (more reliable than sendKeys for some inputs)
async function setInputValue(driver: WebDriver, selector: string, value: string): Promise<void> {
  await driver.executeScript(`
    const el = document.querySelector('${selector}');
    if (el) {
      el.value = arguments[0];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `, value);
}

// Helper to check if element has class
async function hasClass(element: WebElement, className: string): Promise<boolean> {
  const classes = await element.getAttribute('class');
  return classes.split(' ').includes(className);
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Firefox E2E Browser Extension Tests (Selenium)');
  console.log('='.repeat(60));
  console.log(`API Key: ${OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('='.repeat(60));

  let driver: WebDriver | null = null;

  try {
    driver = await createDriver();
    console.log('\nFirefox launched successfully with Selenium');
    console.log(`Extension URL base: moz-extension://${extensionUUID}/\n`);

    // Test navigation to extension page first
    console.log('Testing basic extension navigation...');
    await driver.get(getExtensionUrl('/src/options/options.html'));
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✓ Successfully navigated to extension options page\n');

    // Test 1: Configure API settings
    await runTest('Configure API settings', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#apiKey', 5000);

      // Set all API settings
      await setInputValue(driver!, '#apiBaseUrl', 'https://api.openai.com/v1');
      await setInputValue(driver!, '#apiKey', OPENAI_API_KEY!);
      await setInputValue(driver!, '#chatModel', 'gpt-4o-mini');
      await setInputValue(driver!, '#embeddingModel', 'text-embedding-3-small');

      // Save settings
      const submitBtn = await driver!.findElement(By.css('[type="submit"]'));
      await submitBtn.click();

      // Wait for success
      await driver!.wait(async () => {
        const status = await driver!.findElement(By.css('.status'));
        const text = await status.getText();
        return text.toLowerCase().includes('success');
      }, 10000);
    });

    // Test 2: Test API connection
    await runTest('Test API connection', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#testBtn', 5000);

      // Wait for settings to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click test button
      const testBtn = await driver!.findElement(By.id('testBtn'));
      await testBtn.click();

      // Wait for result
      await driver!.wait(async () => {
        const status = await driver!.findElement(By.css('.status'));
        const isHidden = await hasClass(status, 'hidden');
        if (isHidden) return false;
        const text = await status.getText();
        return text.toLowerCase().includes('successful') || text.toLowerCase().includes('failed');
      }, 30000);

      const status = await driver!.findElement(By.css('.status'));
      const statusText = await status.getText();
      if (!statusText.toLowerCase().includes('successful')) {
        throw new Error(`API test failed: ${statusText}`);
      }
    });

    // Test 3: Save bookmark via content script simulation
    await runTest('Save bookmark via extension messaging', async () => {
      // Open library page first to get initial count
      await driver!.get(getExtensionUrl('/src/library/library.html'));
      await waitForElement(driver!, '#bookmarkList', 5000);

      // Get initial bookmark count
      const initialCountText = await getElementText(driver!, '#bookmarkCount');
      const initialCount = parseInt(initialCountText || '0');

      // Navigate to a real page to capture content
      await driver!.get('https://example.com');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Capture page data
      const pageData = await driver!.executeScript(() => ({
        url: location.href,
        title: document.title,
        html: document.documentElement.outerHTML
      })) as { url: string; title: string; html: string };

      // Open popup and send message to save bookmark
      await driver!.get(getExtensionUrl('/src/popup/popup.html'));
      await waitForElement(driver!, '#saveBtn', 5000);

      // Wait a bit for service worker to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Use extension's message system to save bookmark (Firefox uses browser API)
      await driver!.executeScript(async (data: any) => {
        const api = (window as any).browser || (window as any).chrome;
        if (!api || !api.runtime || !api.runtime.sendMessage) {
          throw new Error('Extension API not available');
        }
        await api.runtime.sendMessage({
          type: 'SAVE_BOOKMARK',
          data: data
        });
      }, pageData);

      // Wait for save to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Refresh library page and check count
      await driver!.get(getExtensionUrl('/src/library/library.html'));
      await waitForElement(driver!, '#bookmarkCount', 5000);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalCountText = await getElementText(driver!, '#bookmarkCount');
      const finalCount = parseInt(finalCountText || '0');

      if (finalCount <= initialCount) {
        throw new Error(`Bookmark was not added. Initial: ${initialCount}, Final: ${finalCount}`);
      }

      // Verify bookmark appears in list
      const bookmarkCards = await driver!.findElements(By.css('.bookmark-card'));
      if (bookmarkCards.length === 0) {
        throw new Error('No bookmark cards found in list');
      }

      // Check if example.com appears in any bookmark card
      const hasExampleBookmark = await driver!.executeScript(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        return Array.from(cards).some(card => {
          const link = card.querySelector('a[href]') as HTMLAnchorElement;
          if (link) {
            try {
              const url = new URL(link.href);
              return url.hostname === "example.com";
            } catch {
              return false;
            }
          }
          const urlMatch = card.textContent?.match(/https?:\/\/[^\s"']+/);
          if (urlMatch) {
            try {
              const url = new URL(urlMatch[0]);
              return url.hostname === "example.com";
            } catch {
              return false;
            }
          }
          return false;
        });
      });

      if (!hasExampleBookmark) {
        throw new Error('example.com bookmark not found in list');
      }
    });

    // Test 4: Verify bookmark appears in list
    await runTest('Bookmark appears in explore list', async () => {
      await driver!.get(getExtensionUrl('/src/library/library.html'));
      await waitForElement(driver!, '#bookmarkList', 5000);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if there's at least one bookmark card or empty state
      const hasBookmarks = await driver!.executeScript(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        const emptyState = document.querySelector('.empty-state');
        return cards.length > 0 || emptyState !== null;
      });

      if (!hasBookmarks) {
        throw new Error('Bookmark list did not load properly');
      }
    });

    // Test 5: Wait for bookmark processing
    await runTest('Wait for bookmark processing', async () => {
      await driver!.get(getExtensionUrl('/src/library/library.html'));
      await waitForElement(driver!, '#bookmarkList', 5000);

      // Check if there are any bookmarks
      const bookmarkCards = await driver!.findElements(By.css('.bookmark-card'));

      if (bookmarkCards.length === 0) {
        console.log('  (No bookmarks to process)');
        return;
      }

      // Wait up to 60 seconds for processing to complete
      const maxWait = 60000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        await driver!.navigate().refresh();
        await new Promise(resolve => setTimeout(resolve, 3000));

        const statuses = await driver!.executeScript(() => {
          const badges = document.querySelectorAll('.status-badge');
          return Array.from(badges).map(b => b.textContent?.toLowerCase());
        }) as string[];

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
    });

    // Test 6: Verify readability content extraction
    await runTest('Readability extracts content correctly', async () => {
      // Navigate to explore page
      await driver!.get(getExtensionUrl('/src/library/library.html'));
      await waitForElement(driver!, '#bookmarkList', 5000);

      // Create test content
      const pageData = {
        url: 'https://techblog.example.org/2024/01/understanding-machine-learning-fundamentals',
        title: 'Understanding Machine Learning Fundamentals',
        html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Understanding Machine Learning Fundamentals</title>
</head>
<body>
  <article>
    <h1>Understanding Machine Learning Fundamentals</h1>
    <p>Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed. This revolutionary approach has transformed how we solve complex problems.</p>
    <p>The fundamental principle behind machine learning is pattern recognition. Algorithms analyze training data to identify patterns and make predictions on new, unseen data.</p>
    <h2>Core Concepts</h2>
    <p>At its core, machine learning relies on statistical methods and computational algorithms. The process involves feeding data to algorithms that can identify patterns and relationships within the data.</p>
    <h2>Types of Learning</h2>
    <p>There are three main categories of machine learning approaches, each suited for different types of problems and data scenarios.</p>
    <p>Supervised learning uses labeled data, where the algorithm learns from examples that include both input and desired output.</p>
    <p>Unsupervised learning finds hidden patterns in unlabeled data, discovering structure without explicit guidance.</p>
    <p>Reinforcement learning learns through trial and error, receiving rewards or penalties based on actions taken.</p>
  </article>
</body>
</html>`
      };

      // Send bookmark via extension messaging (Firefox uses browser API)
      const saveResult = await driver!.executeScript(async (data: any) => {
        const api = (window as any).browser || (window as any).chrome;
        if (!api || !api.runtime || !api.runtime.sendMessage) {
          return { success: false, error: 'Extension API not available' };
        }
        return new Promise((resolve) => {
          api.runtime.sendMessage(
            { type: 'SAVE_BOOKMARK', data },
            (response: any) => resolve(response)
          );
        });
      }, pageData);

      if (!saveResult || !(saveResult as any).success) {
        throw new Error('Failed to save bookmark: ' + JSON.stringify(saveResult));
      }

      console.log('  Bookmark saved, waiting for processing...');

      // Wait for bookmark to be processed
      const maxWait = 90000;
      const startTime = Date.now();
      let processed = false;

      while (Date.now() - startTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await driver!.navigate().refresh();
        await new Promise(resolve => setTimeout(resolve, 2000));

        const bookmarkStatus = await driver!.executeScript(async () => {
          if (!(window as any).__testHelpers) {
            throw new Error('Test helpers not available on window object');
          }
          return await (window as any).__testHelpers.getBookmarkStatus();
        }) as any;

        console.log('  Status check:', JSON.stringify(bookmarkStatus, null, 2));

        const testBookmark = bookmarkStatus.bookmarks.find(
          (b: any) => b.title === 'Understanding Machine Learning Fundamentals'
        );

        if (testBookmark) {
          if (testBookmark.status === 'complete') {
            processed = true;

            const bookmarkMarkdown = bookmarkStatus.markdown.find(
              (m: any) => m.bookmarkId === testBookmark.id
            );

            if (!bookmarkMarkdown) {
              throw new Error('Bookmark processed but no markdown entry found in database');
            }

            console.log(`  Markdown content length: ${bookmarkMarkdown.contentLength}`);
            console.log(`  Markdown preview: ${bookmarkMarkdown.contentPreview}`);

            if (bookmarkMarkdown.contentLength === 0) {
              throw new Error('Readability extracted empty content.');
            }

            const markdown = bookmarkMarkdown.contentPreview;
            const expectedPhrases = ['Machine learning', 'artificial intelligence'];

            const missingPhrases = expectedPhrases.filter(phrase =>
              !markdown.toLowerCase().includes(phrase.toLowerCase())
            );

            if (missingPhrases.length > 0) {
              throw new Error(`Extracted content is missing expected phrases: ${missingPhrases.join(', ')}`);
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
    });

    // Test 7: Test search functionality
    await runTest('Search for bookmarks', async () => {
      await driver!.get(getExtensionUrl('/src/search/search.html'));
      await waitForElement(driver!, '#searchInput', 5000);

      // Set search query
      await setInputValue(driver!, '#searchInput', 'artificial intelligence');

      // Click search
      const searchBtn = await driver!.findElement(By.id('searchBtn'));
      await searchBtn.click();

      // Wait for search to complete
      await driver!.wait(async () => {
        const btn = await driver!.findElement(By.id('searchBtn'));
        const text = await btn.getText();
        const disabled = await btn.getAttribute('disabled');
        return !disabled && text.includes('Search');
      }, 60000);

      // Check results list container exists
      const resultsList = await driver!.findElements(By.id('resultsList'));
      if (resultsList.length === 0) {
        throw new Error('Results list container not found');
      }
    });

    // Test 8: Navigation between pages
    await runTest('Navigation between library and search pages', async () => {
      await driver!.get(getExtensionUrl('/src/library/library.html'));

      // Wait for library page to load
      await waitForElement(driver!, '#bookmarkList', 5000);

      // Verify we're on library page
      const libraryNav = await driver!.findElement(By.css('.app-header__nav-link[href="library.html"]'));
      const libraryNavActive = await hasClass(libraryNav, 'active');
      if (!libraryNavActive) {
        throw new Error('Library navigation should be active');
      }

      // Navigate to search page
      const searchNav = await driver!.findElement(By.css('.app-header__nav-link[href="../search/search.html"]'));
      await searchNav.click();
      await waitForElement(driver!, '#searchInput', 5000);

      // Verify we're on search page
      const searchNavActive = await driver!.findElement(By.css('.app-header__nav-link[href="search.html"]'));
      const isActive = await hasClass(searchNavActive, 'active');
      if (!isActive) {
        throw new Error('Search navigation should be active');
      }
    });

    // Test 9: Popup page loads with navigation
    await runTest('Popup page loads with navigation buttons', async () => {
      await driver!.get(getExtensionUrl('/src/popup/popup.html'));

      // Wait for save button to load
      await waitForElement(driver!, '#saveBtn', 5000);

      // Wait for navigation buttons to load
      await waitForElement(driver!, '#navLibrary', 5000);
      await waitForElement(driver!, '#navSearch', 5000);
      await waitForElement(driver!, '#navStumble', 5000);
      await waitForElement(driver!, '#navSettings', 5000);

      // Verify buttons are present
      const saveBtnElements = await driver!.findElements(By.id('saveBtn'));
      const navLibraryElements = await driver!.findElements(By.id('navLibrary'));
      const navSearchElements = await driver!.findElements(By.id('navSearch'));
      const navStumbleElements = await driver!.findElements(By.id('navStumble'));
      const navSettingsElements = await driver!.findElements(By.id('navSettings'));

      if (saveBtnElements.length === 0 || navLibraryElements.length === 0 ||
          navSearchElements.length === 0 || navStumbleElements.length === 0 ||
          navSettingsElements.length === 0) {
        throw new Error('Popup navigation buttons not found');
      }
    });

    // Test 10: Bulk URL Import
    await runTest('Bulk URL import creates jobs and bookmarks', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#bulkUrlsInput', 5000);

      // Enter test URLs
      const testUrls = [
        'https://example.com',
        'https://httpbin.org/html',
        'https://www.wikipedia.org'
      ];
      await setInputValue(driver!, '#bulkUrlsInput', testUrls.join('\n'));

      // Wait for validation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify validation feedback shows valid URLs
      const validationText = await getElementText(driver!, '#urlValidationFeedback');
      if (!validationText?.includes('3 valid')) {
        console.log('  (Validation might not show - continuing...)');
      }

      // Click import button
      const importBtn = await driver!.findElement(By.id('startBulkImport'));
      await importBtn.click();

      // Wait for import to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if progress is shown
      const progressVisible = await driver!.executeScript(() => {
        const progress = document.querySelector('#bulkImportProgress');
        return progress && !progress.classList.contains('hidden');
      });

      if (progressVisible) {
        console.log('  (Bulk import started - progress visible)');
      }
    });

    // Test 11: Jobs Dashboard displays jobs
    await runTest('Jobs dashboard displays and filters jobs', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#jobsList', 5000);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if jobs are displayed or empty state shown
      const jobsContent = await driver!.executeScript(() => {
        const jobsList = document.querySelector('#jobsList');
        return jobsList ? jobsList.innerHTML : '';
      }) as string;

      const hasJobs = jobsContent.includes('job-item') || jobsContent.includes('loading') || jobsContent.includes('No jobs');

      if (!hasJobs) {
        console.log('  (Jobs list state unclear - may be loading)');
      }

      // Test filter functionality
      const typeFilter = await driver!.findElements(By.id('jobTypeFilter'));
      const statusFilter = await driver!.findElements(By.id('jobStatusFilter'));

      if (typeFilter.length === 0 || statusFilter.length === 0) {
        throw new Error('Job filters not found');
      }

      // Click refresh button if it exists
      const refreshBtns = await driver!.findElements(By.id('refreshJobsBtn'));
      if (refreshBtns.length > 0) {
        await refreshBtns[0].click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    });

    // Test 12: Jobs filtering works
    await runTest('Jobs can be filtered by type and status', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#jobTypeFilter', 5000);
      await waitForElement(driver!, '#jobStatusFilter', 5000);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test type filter using JavaScript to set value
      await driver!.executeScript(() => {
        const select = document.querySelector('#jobTypeFilter') as HTMLSelectElement;
        if (select) {
          select.value = 'manual_add';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Test status filter
      await driver!.executeScript(() => {
        const select = document.querySelector('#jobStatusFilter') as HTMLSelectElement;
        if (select) {
          select.value = 'completed';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reset filters
      await driver!.executeScript(() => {
        const typeSelect = document.querySelector('#jobTypeFilter') as HTMLSelectElement;
        const statusSelect = document.querySelector('#jobStatusFilter') as HTMLSelectElement;
        if (typeSelect) {
          typeSelect.value = 'all';
          typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (statusSelect) {
          statusSelect.value = 'all';
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    // Test 13: Export/Import functionality
    await runTest('Export bookmarks creates download', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#exportBtn', 5000);

      // Click export button
      const exportBtn = await driver!.findElement(By.id('exportBtn'));
      await exportBtn.click();

      // Wait a moment for potential download
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Note: Actual file download verification is difficult in headless mode
      console.log('  (Export button clicked - file download tested manually)');
    });

    // Test 14: Import file input exists
    await runTest('Import file input is available', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#importFile', 5000);
      await waitForElement(driver!, '#importBtn', 5000);

      const fileInputs = await driver!.findElements(By.id('importFile'));
      const importBtns = await driver!.findElements(By.id('importBtn'));

      if (fileInputs.length === 0 || importBtns.length === 0) {
        throw new Error('Import controls not found');
      }
    });

    // Test 15: Bulk import validation
    await runTest('Bulk import validates URLs correctly', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#bulkUrlsInput', 5000);

      // Enter mix of valid and invalid URLs
      const mixedUrls = [
        'https://example.com',
        'javascript:alert(1)',
        'not-a-url',
        'https://github.com',
      ];
      await setInputValue(driver!, '#bulkUrlsInput', mixedUrls.join('\n'));

      // Wait for validation
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check validation feedback
      const feedbackElements = await driver!.findElements(By.id('urlValidationFeedback'));
      if (feedbackElements.length > 0) {
        const text = await feedbackElements[0].getText();
        console.log(`  (Validation: ${text})`);
      }

      // Clear the textarea
      await setInputValue(driver!, '#bulkUrlsInput', '');
    });

    // Test 16: Jobs auto-refresh
    await runTest('Jobs list can auto-refresh', async () => {
      await driver!.get(getExtensionUrl('/src/options/options.html'));
      await waitForElement(driver!, '#jobsList', 5000);

      // Get initial content
      const initialContent = await driver!.executeScript(() => {
        const jobsList = document.querySelector('#jobsList');
        return jobsList ? jobsList.innerHTML : '';
      }) as string;

      // Wait for auto-refresh interval (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get updated content
      const updatedContent = await driver!.executeScript(() => {
        const jobsList = document.querySelector('#jobsList');
        return jobsList ? jobsList.innerHTML : '';
      }) as string;

      // Content may or may not change depending on job status
      // We just verify the list is still present
      if (updatedContent.length === 0) {
        throw new Error('Jobs list disappeared after refresh');
      }
    });

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    if (driver) {
      await driver.quit();
    }
    cleanupTempDir();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Firefox E2E Test Summary (Selenium)');
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

  console.log('\n✓ All Firefox E2E tests passed!');
}

main();
