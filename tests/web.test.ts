/**
 * Web Modality E2E Tests using Puppeteer
 *
 * Tests the standalone web version of Bookmarks by Localforge.
 * This version doesn't require browser extension APIs and can be tested
 * as a regular web application.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BROWSER_PATH = process.env.BROWSER_PATH || '/usr/bin/chromium-browser';
const WEB_PORT = 5174;
const WEB_URL = `http://localhost:${WEB_PORT}/web.html`;

// Test HTML content for bookmarking
const TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Article: Understanding Web Technologies</title>
</head>
<body>
  <article>
    <h1>Understanding Web Technologies</h1>
    <p>Web technologies have evolved significantly over the past decades. From simple static HTML pages to complex interactive applications, the web has become a powerful platform for delivering software and content.</p>
    <h2>Core Technologies</h2>
    <p>HTML provides the structure, CSS handles presentation, and JavaScript enables interactivity. Together, these form the foundation of modern web development.</p>
    <p>Modern frameworks like React, Vue, and Angular build upon these fundamentals to create sophisticated user interfaces.</p>
  </article>
</body>
</html>`;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let devServer: ChildProcess | null = null;

async function startDevServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('Starting Vite dev server...');

    devServer = spawn('npm', ['run', 'dev:web'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        reject(new Error('Dev server failed to start within timeout'));
      }
    }, 30000);

    devServer.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[dev-server]', output.trim());
      if (output.includes('Local:') && output.includes(String(WEB_PORT))) {
        started = true;
        clearTimeout(timeout);
        // Give server a moment to fully initialize
        setTimeout(resolve, 1000);
      }
    });

    devServer.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      // Ignore xdg-open errors (no display in CI)
      if (!output.includes('xdg-open')) {
        console.error('[dev-server error]', output.trim());
      }
    });

    devServer.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    devServer.on('exit', (code) => {
      if (!started && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Dev server exited with code ${code}`));
      }
    });
  });
}

function stopDevServer(): void {
  if (devServer) {
    console.log('Stopping dev server...');
    devServer.kill('SIGTERM');
    devServer = null;
  }
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
  console.log('Web Modality E2E Tests');
  console.log('='.repeat(60));
  console.log(`Browser: ${BROWSER_PATH}`);
  console.log(`URL: ${WEB_URL}`);
  console.log('='.repeat(60));

  let browser: Browser | null = null;

  try {
    // Start dev server
    await startDevServer();

    // Launch browser
    browser = await puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    // Test 1: Page loads correctly
    await runTest('Page loads correctly', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Check for main elements
      const title = await page.title();
      if (!title.includes('Bookmarks')) {
        throw new Error(`Unexpected page title: ${title}`);
      }

      // Check navigation elements exist
      const navAdd = await page.$('#navAdd');
      const navExplore = await page.$('#navExplore');
      const navSettings = await page.$('#navSettings');

      if (!navAdd || !navExplore || !navSettings) {
        throw new Error('Navigation elements not found');
      }

      await page.close();
    });

    // Test 2: Navigation between views
    await runTest('Navigation between views works', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Default should be Add view
      let addViewActive = await page.$eval('#addView', el => el.classList.contains('active'));
      if (!addViewActive) {
        throw new Error('Add view should be active by default');
      }

      // Click Explore
      await page.click('#navExplore');
      await new Promise(resolve => setTimeout(resolve, 300));

      const exploreViewActive = await page.$eval('#exploreView', el => el.classList.contains('active'));
      if (!exploreViewActive) {
        throw new Error('Explore view should be active after clicking');
      }

      // Click Settings
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      const settingsViewActive = await page.$eval('#settingsView', el => el.classList.contains('active'));
      if (!settingsViewActive) {
        throw new Error('Settings view should be active after clicking');
      }

      // Click Add
      await page.click('#navAdd');
      await new Promise(resolve => setTimeout(resolve, 300));

      addViewActive = await page.$eval('#addView', el => el.classList.contains('active'));
      if (!addViewActive) {
        throw new Error('Add view should be active after clicking back');
      }

      await page.close();
    });

    // Test 3: Settings can be saved
    await runTest('Settings can be saved and loaded', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to settings
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Fill in settings
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value = '');
      await page.type('#apiBaseUrl', 'https://api.test.com/v1');

      await page.$eval('#apiKey', (el: HTMLInputElement) => el.value = '');
      await page.type('#apiKey', 'test-api-key-12345');

      await page.$eval('#chatModel', (el: HTMLInputElement) => el.value = '');
      await page.type('#chatModel', 'test-model');

      // Save settings
      await page.click('#saveSettingsBtn');

      // Wait for save confirmation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check status message
      const statusVisible = await page.$eval('#settingsStatus', el => !el.classList.contains('hidden'));
      if (!statusVisible) {
        throw new Error('Settings status message should be visible after save');
      }

      // Reload page and verify settings persisted
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      const savedUrl = await page.$eval('#apiBaseUrl', (el: HTMLInputElement) => el.value);
      if (savedUrl !== 'https://api.test.com/v1') {
        throw new Error(`Settings not persisted. Expected https://api.test.com/v1, got ${savedUrl}`);
      }

      await page.close();
    });

    // Test 4: Add bookmark via HTML paste
    await runTest('Bookmark can be added via HTML paste', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Should be on Add view by default
      await page.waitForSelector('#htmlInput', { timeout: 5000 });

      // Enter URL
      await page.type('#urlInput', 'https://test-article.example.com/web-technologies');

      // Paste HTML
      await page.type('#htmlInput', TEST_HTML);

      // Save button should be enabled
      await new Promise(resolve => setTimeout(resolve, 300));
      const saveDisabled = await page.$eval('#saveBtn', (el: HTMLButtonElement) => el.disabled);
      if (saveDisabled) {
        throw new Error('Save button should be enabled after entering URL and HTML');
      }

      // Click save
      await page.click('#saveBtn');

      // Wait for save to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check status message
      const statusText = await page.$eval('#addStatus', el => el.textContent || '');
      if (!statusText.toLowerCase().includes('saved')) {
        throw new Error(`Unexpected status after save: ${statusText}`);
      }

      await page.close();
    });

    // Test 5: Bookmark appears in explore list
    await runTest('Saved bookmark appears in explore list', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to explore
      await page.click('#navExplore');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Wait for bookmarks to load
      await page.waitForSelector('#bookmarkList', { timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check bookmark count
      const countText = await page.$eval('#bookmarkCount', el => el.textContent);
      const count = parseInt(countText || '0');

      if (count === 0) {
        throw new Error('Bookmark count should be at least 1');
      }

      // Check for bookmark card
      const hasCard = await page.$('.bookmark-card');
      if (!hasCard) {
        throw new Error('No bookmark cards found');
      }

      // Check that our test bookmark is in the list
      const hasTestBookmark = await page.evaluate(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        return Array.from(cards).some(card => {
          const text = card.textContent || "";
          // Check for article title as before
          if (text.includes('Web Technologies')) return true;
          // Try to extract URLs and check the hostname
          // (Assume the full URL is present in text; otherwise, look for a link)
          try {
            // Find an anchor element if present, else use the full text
            const a = card.querySelector('a');
            let urlText = a ? a.href : text.trim();
            if (!/^https?:\/\//.test(urlText)) return false; // Not a URL
            const url = new URL(urlText);
            return url.hostname === 'test-article.example.com';
          } catch { return false; }
        });
      });

      if (!hasTestBookmark) {
        throw new Error('Test bookmark not found in list');
      }

      await page.close();
    });

    // Test 6: Bookmark detail view opens
    await runTest('Bookmark detail view opens on click', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to explore
      await page.click('#navExplore');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Wait for bookmarks
      await page.waitForSelector('.bookmark-card', { timeout: 5000 });

      // Click on the first bookmark
      await page.click('.bookmark-card');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if detail view is active
      const detailActive = await page.$eval('#detailView', el => el.classList.contains('active'));
      if (!detailActive) {
        throw new Error('Detail view should be active after clicking bookmark');
      }

      // Check backdrop is active
      const backdropActive = await page.$eval('#detailBackdrop', el => el.classList.contains('active'));
      if (!backdropActive) {
        throw new Error('Backdrop should be active when detail view is open');
      }

      // Close detail view
      await page.click('#closeDetailBtn');
      await new Promise(resolve => setTimeout(resolve, 300));

      const detailClosed = await page.$eval('#detailView', el => !el.classList.contains('active'));
      if (!detailClosed) {
        throw new Error('Detail view should close after clicking back button');
      }

      await page.close();
    });

    // Test 7: Export button exists and is clickable
    await runTest('Export functionality is available', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to settings
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check export button exists
      const exportBtn = await page.$('#exportBtn');
      if (!exportBtn) {
        throw new Error('Export button not found');
      }

      // Button should be clickable (we can't fully test download in headless mode)
      const isDisabled = await page.$eval('#exportBtn', (el: HTMLButtonElement) => el.disabled);
      if (isDisabled) {
        throw new Error('Export button should not be disabled');
      }

      await page.close();
    });

    // Test 8: Import file input exists
    await runTest('Import file input is available', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to settings
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check import file input exists
      const importFile = await page.$('#importFile');
      if (!importFile) {
        throw new Error('Import file input not found');
      }

      await page.close();
    });

    // Test 9: View toggle in explore works
    await runTest('View toggle between Recent and Search works', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to explore
      await page.click('#navExplore');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Default should be list view
      const listActive = await page.$eval('#listViewBtn', el => el.classList.contains('active'));
      if (!listActive) {
        throw new Error('List view should be active by default');
      }

      // Click search view
      await page.click('#searchViewBtn');
      await new Promise(resolve => setTimeout(resolve, 300));

      const searchActive = await page.$eval('#searchViewBtn', el => el.classList.contains('active'));
      if (!searchActive) {
        throw new Error('Search view should be active after clicking');
      }

      const searchSubviewActive = await page.$eval('#searchSubview', el => el.classList.contains('active'));
      if (!searchSubviewActive) {
        throw new Error('Search subview should be active');
      }

      // Click back to list
      await page.click('#listViewBtn');
      await new Promise(resolve => setTimeout(resolve, 300));

      const listActiveAgain = await page.$eval('#listViewBtn', el => el.classList.contains('active'));
      if (!listActiveAgain) {
        throw new Error('List view should be active after clicking back');
      }

      await page.close();
    });

    // Test 10: Clear data button exists
    await runTest('Clear data button is available', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to settings
      await page.click('#navSettings');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check clear data button exists
      const clearBtn = await page.$('#clearDataBtn');
      if (!clearBtn) {
        throw new Error('Clear data button not found');
      }

      await page.close();
    });

    // Test 11: Preview button functionality
    await runTest('Preview button shows content in iframe', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Enter some HTML
      await page.type('#htmlInput', '<html><body><h1>Preview Test</h1></body></html>');

      // Preview button should be enabled
      await new Promise(resolve => setTimeout(resolve, 300));
      const previewDisabled = await page.$eval('#previewBtn', (el: HTMLButtonElement) => el.disabled);
      if (previewDisabled) {
        throw new Error('Preview button should be enabled after entering HTML');
      }

      // Click preview
      await page.click('#previewBtn');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check preview panel is visible
      const previewVisible = await page.$eval('#previewPanel', el => !el.classList.contains('hidden'));
      if (!previewVisible) {
        throw new Error('Preview panel should be visible after clicking preview');
      }

      // Close preview
      await page.click('#closePreviewBtn');
      await new Promise(resolve => setTimeout(resolve, 300));

      const previewHidden = await page.$eval('#previewPanel', el => el.classList.contains('hidden'));
      if (!previewHidden) {
        throw new Error('Preview panel should be hidden after closing');
      }

      await page.close();
    });

    // Test 12: Delete bookmark
    await runTest('Bookmark can be deleted', async () => {
      const page = await browser!.newPage();
      await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

      // Navigate to explore
      await page.click('#navExplore');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get initial count
      const initialCount = await page.$eval('#bookmarkCount', el => parseInt(el.textContent || '0'));

      if (initialCount === 0) {
        console.log('  (No bookmarks to delete - skipping)');
        await page.close();
        return;
      }

      // Open first bookmark
      await page.click('.bookmark-card');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Set up dialog handler to accept confirmation
      page.on('dialog', async dialog => {
        await dialog.accept();
      });

      // Click delete
      await page.click('#deleteBtn');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check detail view closed
      const detailClosed = await page.$eval('#detailView', el => !el.classList.contains('active'));
      if (!detailClosed) {
        throw new Error('Detail view should close after delete');
      }

      // Check count decreased
      const finalCount = await page.$eval('#bookmarkCount', el => parseInt(el.textContent || '0'));
      if (finalCount >= initialCount) {
        throw new Error(`Bookmark count should decrease. Initial: ${initialCount}, Final: ${finalCount}`);
      }

      await page.close();
    });

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
    stopDevServer();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Web Modality E2E Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

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

  console.log('\n✓ All web modality tests passed!');
}

// Handle cleanup on exit
process.on('SIGINT', () => { stopDevServer(); process.exit(1); });
process.on('SIGTERM', () => { stopDevServer(); process.exit(1); });
process.on('exit', () => { stopDevServer(); });

main();
