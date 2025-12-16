/**
 * Web E2E Tests using Puppeteer
 *
 * This file contains end-to-end tests for the web version (standalone webapp).
 * These tests verify that the webapp works correctly without the browser extension.
 * Uses mock OpenAI API server for fast, cheap testing with one real API test at the end.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST_PATH = path.resolve(__dirname, '../dist-web');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BROWSER_PATH = process.env.BROWSER_PATH;

// Verify dist-web exists
if (!fs.existsSync(WEB_DIST_PATH)) {
  console.error('ERROR: dist-web not found. Run "npm run build:web" first.');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

if (!BROWSER_PATH) {
  console.error('ERROR: BROWSER_PATH environment variable is required');
  process.exit(1);
}

// ============================================================================
// MOCK OpenAI API RESPONSES
// ============================================================================

function generateMockEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

function getMockQAPairsResponse(): object {
  return {
    id: 'mock-chat-completion',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({
          pairs: [
            { question: 'What is this page about?', answer: 'This is a test page.' },
            { question: 'What is the main topic?', answer: 'Testing the webapp.' },
          ]
        })
      },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  };
}

function getMockEmbeddingsResponse(inputCount: number): object {
  return {
    object: 'list',
    data: Array.from({ length: inputCount }, (_, i) => ({
      object: 'embedding',
      index: i,
      embedding: generateMockEmbedding()
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: inputCount * 10, total_tokens: inputCount * 10 }
  };
}

// ============================================================================
// LOCAL SERVERS
// ============================================================================

let mockApiServer: http.Server | null = null;
let mockApiPort = 0;
let webServer: http.Server | null = null;
let webServerPort = 0;

/**
 * Start a local mock server that mimics OpenAI API responses
 */
async function startMockApiServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    mockApiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        const url = req.url || '';

        if (url.includes('/chat/completions')) {
          res.statusCode = 200;
          res.end(JSON.stringify(getMockQAPairsResponse()));
        } else if (url.includes('/embeddings')) {
          let inputCount = 1;
          if (body) {
            try {
              const parsed = JSON.parse(body);
              inputCount = Array.isArray(parsed.input) ? parsed.input.length : 1;
            } catch { /* default */ }
          }
          res.statusCode = 200;
          res.end(JSON.stringify(getMockEmbeddingsResponse(inputCount)));
        } else if (url.includes('/models')) {
          res.statusCode = 200;
          res.end(JSON.stringify({
            object: 'list',
            data: [{ id: 'gpt-4o-mini', object: 'model' }, { id: 'text-embedding-3-small', object: 'model' }]
          }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
    });

    mockApiServer.listen(0, '127.0.0.1', () => {
      const addr = mockApiServer!.address();
      if (addr && typeof addr === 'object') {
        mockApiPort = addr.port;
        const url = `http://127.0.0.1:${mockApiPort}`;
        console.log(`Mock OpenAI API server running at ${url}`);
        resolve(url);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    mockApiServer.on('error', reject);
  });
}

/**
 * Start a static file server for the webapp
 */
async function startWebServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    webServer = http.createServer((req, res) => {
      let url = req.url || '/';

      // Remove /webapp prefix if present
      if (url.startsWith('/webapp')) {
        url = url.slice('/webapp'.length) || '/';
      }

      // Default to index.html for directory requests
      if (url === '/' || url === '') {
        url = '/src/web/index.html';
      }

      // Handle .html extensions for pages
      if (!path.extname(url) && !url.includes('.')) {
        url = url + '.html';
      }

      const filePath = path.join(WEB_DIST_PATH, url);

      // Security check - prevent path traversal
      if (!filePath.startsWith(WEB_DIST_PATH)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // Try index.html fallback for SPA routing
          if (err.code === 'ENOENT') {
            const indexPath = path.join(WEB_DIST_PATH, 'src/web/index.html');
            fs.readFile(indexPath, (err2, data2) => {
              if (err2) {
                res.statusCode = 404;
                res.end('Not found');
              } else {
                res.setHeader('Content-Type', 'text/html');
                res.end(data2);
              }
            });
          } else {
            res.statusCode = 500;
            res.end('Server error');
          }
          return;
        }

        // Set content type based on extension
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
        };
        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
        res.end(data);
      });
    });

    webServer.listen(0, '127.0.0.1', () => {
      const addr = webServer!.address();
      if (addr && typeof addr === 'object') {
        webServerPort = addr.port;
        const url = `http://127.0.0.1:${webServerPort}`;
        console.log(`Web server running at ${url}`);
        resolve(url);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    webServer.on('error', reject);
  });
}

async function stopServers(): Promise<void> {
  await Promise.all([
    new Promise<void>((resolve) => {
      if (mockApiServer) mockApiServer.close(() => resolve());
      else resolve();
    }),
    new Promise<void>((resolve) => {
      if (webServer) webServer.close(() => resolve());
      else resolve();
    }),
  ]);
}

// ============================================================================
// TEST HELPERS
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

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

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Web E2E Tests (Standalone Webapp)');
  console.log('='.repeat(60));
  console.log(`API Key: ${OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('Mode: MOCK API (with 1 real API test at the end)');
  console.log('='.repeat(60));

  let browser: Browser | null = null;
  let mockApiUrl = '';
  let webUrl = '';

  try {
    // Start servers
    mockApiUrl = await startMockApiServer();
    webUrl = await startWebServer();
    console.log(`\nServers started. Mock API: ${mockApiUrl}, Web: ${webUrl}\n`);

    // Launch browser (no extension needed for web tests)
    browser = await puppeteer.launch({
      executablePath: BROWSER_PATH,
      headless: true, // Can run headless for web tests
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    // ========================================================================
    // MOCKED API TESTS
    // ========================================================================
    console.log('\n--- MOCKED API TESTS ---\n');

    // Test 1: Index page loads
    await runTest('Index page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/web/index.html`);

      // Wait for the page to load
      await page.waitForSelector('body', { timeout: 5000 });

      // Verify we're on the webapp
      const title = await page.title();
      if (!title) {
        throw new Error('Page title not found');
      }

      await page.close();
    });

    // Test 2: Library page loads
    await runTest('Library page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/library/library.html`);

      await page.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Verify bookmark list container exists
      const bookmarkList = await page.$('#bookmarkList');
      if (!bookmarkList) {
        throw new Error('Bookmark list not found');
      }

      await page.close();
    });

    // Test 3: Search page loads
    await runTest('Search page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/search/search.html`);

      await page.waitForSelector('#searchInput', { timeout: 5000 });

      // Verify search input exists
      const searchInput = await page.$('#searchInput');
      if (!searchInput) {
        throw new Error('Search input not found');
      }

      await page.close();
    });

    // Test 4: Options/Settings page loads
    await runTest('Options page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Verify settings form elements exist
      const apiKeyInput = await page.$('#apiKey');
      const apiBaseUrlInput = await page.$('#apiBaseUrl');

      if (!apiKeyInput || !apiBaseUrlInput) {
        throw new Error('Settings form elements not found');
      }

      await page.close();
    });

    // Test 5: Configure API settings (with mock server)
    await runTest('Configure API settings', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Set API settings to use mock server
      await page.$eval('#apiBaseUrl', (el: HTMLInputElement, url: string) => el.value = url, mockApiUrl);
      await page.$eval('#apiKey', (el: HTMLInputElement) => el.value = 'mock-api-key');
      await page.$eval('#chatModel', (el: HTMLInputElement) => el.value = 'gpt-4o-mini');
      await page.$eval('#embeddingModel', (el: HTMLInputElement) => el.value = 'text-embedding-3-small');

      // Save settings
      await page.click('[type="submit"]');

      // Wait for success message
      await page.waitForFunction(
        () => {
          const status = document.querySelector('.status');
          return status && status.textContent?.includes('success');
        },
        { timeout: 10000 }
      );

      await page.close();
    });

    // Test 6: Stumble page loads
    await runTest('Stumble page loads', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/stumble/stumble.html`);

      await page.waitForSelector('#stumbleBtn', { timeout: 5000 });

      // Verify stumble button exists
      const stumbleBtn = await page.$('#stumbleBtn');
      if (!stumbleBtn) {
        throw new Error('Stumble button not found');
      }

      await page.close();
    });

    // Test 7: Bulk import UI is available
    await runTest('Bulk import UI is available', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#bulkUrlsInput', { timeout: 5000 });
      await page.waitForSelector('#startBulkImport', { timeout: 5000 });

      // Verify bulk import elements exist
      const textarea = await page.$('#bulkUrlsInput');
      const importBtn = await page.$('#startBulkImport');

      if (!textarea || !importBtn) {
        throw new Error('Bulk import UI elements not found');
      }

      await page.close();
    });

    // Test 8: Bulk import validates URLs
    await runTest('Bulk import validates URLs', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#bulkUrlsInput', { timeout: 5000 });

      // Enter mix of valid and invalid URLs
      const testUrls = [
        'https://example.com',
        'javascript:alert(1)',
        'not-a-url',
      ].join('\n');

      await page.$eval('#bulkUrlsInput', (el: HTMLTextAreaElement, urls: string) => {
        el.value = urls;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, testUrls);

      // Wait for validation feedback
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check validation feedback shows
      const feedback = await page.$('#urlValidationFeedback');
      if (!feedback) {
        throw new Error('Validation feedback element not found');
      }

      await page.close();
    });

    // Test 9: Export button exists
    await runTest('Export button exists', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#exportBtn', { timeout: 5000 });

      const exportBtn = await page.$('#exportBtn');
      if (!exportBtn) {
        throw new Error('Export button not found');
      }

      await page.close();
    });

    // Test 10: Import file input exists
    await runTest('Import file input exists', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#importFile', { timeout: 5000 });

      const importFile = await page.$('#importFile');
      if (!importFile) {
        throw new Error('Import file input not found');
      }

      await page.close();
    });

    // Test 11: Jobs dashboard exists
    await runTest('Jobs dashboard exists', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#jobsList', { timeout: 5000 });

      const jobsList = await page.$('#jobsList');
      const typeFilter = await page.$('#jobTypeFilter');
      const statusFilter = await page.$('#jobStatusFilter');

      if (!jobsList || !typeFilter || !statusFilter) {
        throw new Error('Jobs dashboard elements not found');
      }

      await page.close();
    });

    // Test 12: Navigation between pages works
    await runTest('Navigation between pages', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/library/library.html`);

      await page.waitForSelector('#bookmarkList', { timeout: 5000 });

      // Navigate to search page
      await page.click('.app-header__nav-link[href="../search/search.html"]');
      await page.waitForSelector('#searchInput', { timeout: 5000 });

      // Verify we're on search page
      const searchInput = await page.$('#searchInput');
      if (!searchInput) {
        throw new Error('Failed to navigate to search page');
      }

      await page.close();
    });

    // ========================================================================
    // ONE REAL API TEST
    // ========================================================================
    console.log('\n--- REAL API TEST (1 test with actual OpenAI API) ---\n');

    // Reconfigure to use real OpenAI API
    await runTest('Configure real OpenAI API', async () => {
      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

      await page.waitForSelector('#apiKey', { timeout: 5000 });

      // Set real API settings
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

    // Real API test - test connection
    await runTest('[REAL API] Test API connection', async () => {
      console.log('  Using REAL OpenAI API...');

      const page = await browser!.newPage();
      await page.goto(`${webUrl}/src/options/options.html`);

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

      console.log('  ✓ Real API connection successful');

      await page.close();
    });

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await stopServers();
    console.log('Servers stopped');

    if (browser) {
      await browser.close();
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Web E2E Test Summary');
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

  console.log('\n✓ All Web E2E tests passed!');
}

main();
