/**
 * Screenshot Capture Script for Landing Page
 *
 * This script uses Puppeteer to capture screenshots of the browser extension
 * for use on the landing page. It captures:
 * - Popup (320x180)
 * - Explore/Library page (1200x800)
 * - Search results (1200x800)
 *
 * Usage:
 *   BROWSER_PATH=/path/to/chromium npx tsx scripts/capture-screenshots.ts
 *
 * Environment variables:
 *   BROWSER_PATH - Path to Chromium/Chrome executable (required)
 *   EXTENSION_PATH - Path to built extension (default: dist-chrome)
 *   OUTPUT_DIR - Output directory for screenshots (default: landing)
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
  : path.resolve(PROJECT_ROOT, 'dist-chrome');

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.OUTPUT_DIR)
  : path.resolve(PROJECT_ROOT, 'landing');

const BROWSER_PATH = process.env.BROWSER_PATH;

const USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-screenshot-profile-'));

function cleanupUserDataDir() {
  try {
    if (fs.existsSync(USER_DATA_DIR)) {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    }
  } catch {
  }
}

process.on('exit', cleanupUserDataDir);
process.on('SIGINT', () => { cleanupUserDataDir(); process.exit(1); });
process.on('SIGTERM', () => { cleanupUserDataDir(); process.exit(1); });

if (!BROWSER_PATH) {
  console.error('ERROR: BROWSER_PATH environment variable is required');
  console.error('Example: BROWSER_PATH=/usr/bin/chromium-browser npx tsx scripts/capture-screenshots.ts');
  process.exit(1);
}

async function launchBrowser(): Promise<Browser> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension path does not exist: ${EXTENSION_PATH}\nRun 'npm run build:chrome' first.`);
  }

  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Extension manifest not found: ${manifestPath}`);
  }

  console.log(`Extension path: ${EXTENSION_PATH}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`User data dir: ${USER_DATA_DIR}`);
  console.log(`Browser path: ${BROWSER_PATH}`);

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
      '--window-size=1400,900',
    ],
  });
  return browser;
}

async function getExtensionId(browser: Browser): Promise<string> {
  const EXTENSION_TIMEOUT = 30000;

  try {
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

  const extensionTarget = await browser.waitForTarget(
    target => target.url().includes('chrome-extension://'),
    { timeout: 10000 }
  );

  const url = extensionTarget.url();
  const match = url.match(/chrome-extension:\/\/([^/]+)/);

  if (!match) {
    throw new Error('Could not extract extension ID from URL: ' + url);
  }

  return match[1];
}

function getExtensionUrl(extensionId: string, pagePath: string): string {
  return `chrome-extension://${extensionId}${pagePath}`;
}

async function setTheme(page: Page, theme: string): Promise<void> {
  await page.evaluate((themeName) => {
    document.documentElement.setAttribute('data-theme', themeName);
  }, theme);
}

async function injectDemoData(page: Page): Promise<void> {
  await page.evaluate(`(async () => {
    const DB_NAME = 'BookmarkRAG';
    const DB_VERSION = 1;

    // Dexie uses different version numbering than raw IndexedDB (multiplies by 10)
    await new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = () => resolve();
    });

    function openDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('bookmarks')) {
            db.createObjectStore('bookmarks', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('markdown')) {
            db.createObjectStore('markdown', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('questionsAnswers')) {
            db.createObjectStore('questionsAnswers', { keyPath: 'id' });
          }
        };
      });
    }

    function putRecord(db, storeName, record) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(record);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }

    function clearStore(db, storeName) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }

    const db = await openDb();

    await clearStore(db, 'bookmarks');
    await clearStore(db, 'markdown');
    await clearStore(db, 'questionsAnswers');

    const demoBookmarks = [
      {
        id: 'demo-1',
        url: 'https://developer.mozilla.org/docs/Web/JavaScript/Guide',
        title: 'JavaScript Guide - MDN Web Docs',
        html: '',
        status: 'complete',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
      {
        id: 'demo-2',
        url: 'https://react.dev/learn',
        title: 'Quick Start - React Documentation',
        html: '',
        status: 'complete',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
      {
        id: 'demo-3',
        url: 'https://www.typescriptlang.org/docs/handbook',
        title: 'TypeScript Handbook',
        html: '',
        status: 'complete',
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
      {
        id: 'demo-4',
        url: 'https://nodejs.org/en/learn/getting-started',
        title: 'Introduction to Node.js',
        html: '',
        status: 'processing',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        updatedAt: new Date(),
      },
      {
        id: 'demo-5',
        url: 'https://css-tricks.com/guides/flexbox',
        title: 'A Complete Guide to Flexbox',
        html: '',
        status: 'complete',
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      },
    ];

    for (const bookmark of demoBookmarks) {
      await putRecord(db, 'bookmarks', bookmark);

      if (bookmark.status === 'complete') {
        await putRecord(db, 'markdown', {
          id: 'md-' + bookmark.id,
          bookmarkId: bookmark.id,
          content: '# ' + bookmark.title + '\\n\\nThis is sample content for the demo bookmark.',
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        });

        await putRecord(db, 'questionsAnswers', {
          id: 'qa-' + bookmark.id + '-1',
          bookmarkId: bookmark.id,
          question: 'What is this article about?',
          answer: 'This article covers ' + bookmark.title.toLowerCase() + '.',
          embeddingQuestion: Array(1536).fill(0),
          embeddingAnswer: Array(1536).fill(0),
          embeddingBoth: Array(1536).fill(0),
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        });

        await putRecord(db, 'questionsAnswers', {
          id: 'qa-' + bookmark.id + '-2',
          bookmarkId: bookmark.id,
          question: 'What are the key concepts?',
          answer: 'The key concepts include core fundamentals and best practices.',
          embeddingQuestion: Array(1536).fill(0),
          embeddingAnswer: Array(1536).fill(0),
          embeddingBoth: Array(1536).fill(0),
          createdAt: bookmark.createdAt,
          updatedAt: bookmark.updatedAt,
        });
      }
    }

    db.close();
    console.log('Demo data injected successfully');
  })()`);
}

async function capturePopup(browser: Browser, extensionId: string): Promise<void> {
  console.log('\nCapturing popup screenshot...');

  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 240 });
  await page.goto(getExtensionUrl(extensionId, '/src/popup/popup.html'));

  await page.waitForSelector('#saveBtn', { timeout: 5000 });

  await setTheme(page, 'terminal');
  await new Promise(resolve => setTimeout(resolve, 1000));

  await page.evaluate(() => {
    const totalCount = document.querySelector('#totalCount');
    const pendingCount = document.querySelector('#pendingCount');
    const completeCount = document.querySelector('#completeCount');
    if (totalCount) totalCount.textContent = '47';
    if (pendingCount) pendingCount.textContent = '2';
    if (completeCount) completeCount.textContent = '45';
  });

  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-popup.png'),
    clip: { x: 0, y: 0, width: 320, height: 240 },
  });

  console.log('  Saved: screenshot-popup.png');
  await page.close();
}

async function captureExplore(browser: Browser, extensionId: string): Promise<void> {
  console.log('\nCapturing explore/library screenshot...');

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(getExtensionUrl(extensionId, '/src/library/library.html'));

  await page.waitForSelector('#bookmarkList', { timeout: 5000 });

  await injectDemoData(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bookmarkList', { timeout: 5000 });

  await setTheme(page, 'terminal');
  await new Promise(resolve => setTimeout(resolve, 2000));

  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-explore.png'),
  });

  console.log('  Saved: screenshot-explore.png');
  await page.close();
}

async function captureSearch(browser: Browser, extensionId: string): Promise<void> {
  console.log('\nCapturing search screenshot...');

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(getExtensionUrl(extensionId, '/src/search/search.html'));

  await page.waitForSelector('#searchInput', { timeout: 5000 });

  await injectDemoData(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#searchInput', { timeout: 5000 });

  await setTheme(page, 'terminal');
  await new Promise(resolve => setTimeout(resolve, 1000));

  await page.type('#searchInput', 'javascript fundamentals');
  await new Promise(resolve => setTimeout(resolve, 500));

  await page.evaluate(() => {
    const resultsList = document.querySelector('#resultsList');
    if (resultsList) {
      resultsList.innerHTML = `
        <div class="search-result bookmark-card" style="padding: 16px; border: 1px solid var(--border-primary); border-radius: 8px; margin-bottom: 12px; background: var(--bg-secondary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-weight: 600; margin-bottom: 4px;">JavaScript Guide - MDN Web Docs</div>
              <div style="font-size: 13px; color: var(--text-secondary);">developer.mozilla.org · 2h ago</div>
            </div>
            <div style="color: var(--status-success); font-size: 13px; font-weight: 500;">94%</div>
          </div>
          <div style="margin-top: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 13px;">
            <div style="color: var(--text-secondary); margin-bottom: 4px;">Q: What are JavaScript fundamentals?</div>
            <div>A: JavaScript fundamentals include variables, data types, functions, control flow, and object-oriented concepts...</div>
          </div>
        </div>
        <div class="search-result bookmark-card" style="padding: 16px; border: 1px solid var(--border-primary); border-radius: 8px; margin-bottom: 12px; background: var(--bg-secondary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-weight: 600; margin-bottom: 4px;">Quick Start - React Documentation</div>
              <div style="font-size: 13px; color: var(--text-secondary);">react.dev · 1 day ago</div>
            </div>
            <div style="color: var(--status-success); font-size: 13px; font-weight: 500;">87%</div>
          </div>
          <div style="margin-top: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 13px;">
            <div style="color: var(--text-secondary); margin-bottom: 4px;">Q: How does React relate to JavaScript?</div>
            <div>A: React is a JavaScript library for building user interfaces, leveraging core JS concepts like components and state...</div>
          </div>
        </div>
        <div class="search-result bookmark-card" style="padding: 16px; border: 1px solid var(--border-primary); border-radius: 8px; margin-bottom: 12px; background: var(--bg-secondary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-weight: 600; margin-bottom: 4px;">TypeScript Handbook</div>
              <div style="font-size: 13px; color: var(--text-secondary);">typescriptlang.org · 3 days ago</div>
            </div>
            <div style="color: var(--status-success); font-size: 13px; font-weight: 500;">82%</div>
          </div>
          <div style="margin-top: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 13px;">
            <div style="color: var(--text-secondary); margin-bottom: 4px;">Q: What is the relationship between TypeScript and JavaScript?</div>
            <div>A: TypeScript is a typed superset of JavaScript that compiles to plain JavaScript, adding static type checking...</div>
          </div>
        </div>
      `;
    }

    const resultCount = document.querySelector('#resultCount');
    if (resultCount) resultCount.textContent = '3';
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'screenshot-search.png'),
  });

  console.log('  Saved: screenshot-search.png');
  await page.close();
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Screenshot Capture for Landing Page');
  console.log('='.repeat(60));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const extensionId = await getExtensionId(browser);
    console.log(`\nExtension ID: ${extensionId}`);

    await capturePopup(browser, extensionId);
    await captureExplore(browser, extensionId);
    await captureSearch(browser, extensionId);

    console.log('\n' + '='.repeat(60));
    console.log('All screenshots captured successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nError capturing screenshots:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
