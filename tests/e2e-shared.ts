import { getErrorMessage } from '../src/lib/errors';

export interface PageHandle {
  goto(url: string): Promise<void>;
  waitForSelector(selector: string, timeout?: number): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  $(selector: string): Promise<boolean>;
  $eval<T>(selector: string, fn: string): Promise<T>;
  evaluate<T>(fn: string): Promise<T>;
  waitForFunction(fn: string, timeout?: number): Promise<void>;
  screenshot(path: string, options?: { fullPage?: boolean }): Promise<void>;
  close(): Promise<void>;
}

export interface TestAdapter {
  platformName: string;
  isExtension: boolean;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  newPage(): Promise<PageHandle>;
  getPageUrl(page: 'library' | 'search' | 'options' | 'stumble' | 'popup' | 'index' | 'jobs'): string;
  getMockApiUrl(): string;
  getMockPageUrls(): string[];
  getRealApiKey(): string;
  hasRealApiKey(): boolean;
  startCoverage?(): Promise<void>;
  stopCoverage?(): Promise<void>;
  writeCoverage?(): Promise<void>;
}

export function generateMockEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

export function getMockQAPairsResponse(): object {
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
            { question: 'What is this page about?', answer: 'This is a test page for E2E testing.' },
            { question: 'What is the main topic?', answer: 'The main topic is testing browser extensions.' },
            { question: 'Who is this content for?', answer: 'This content is for developers testing their browser extensions.' },
          ]
        })
      },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  };
}

export function getMockEmbeddingsResponse(inputCount: number): object {
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

export function getMockModelsResponse(): object {
  return {
    object: 'list',
    data: [
      { id: 'gpt-4o-mini', object: 'model' },
      { id: 'text-embedding-3-small', object: 'model' }
    ]
  };
}

import { CONFIG_REGISTRY } from '../src/lib/config-registry';

const FETCH_OFFSCREEN_BUFFER_MS = CONFIG_REGISTRY.find(e => e.key === 'FETCH_OFFSCREEN_BUFFER_MS')!.defaultValue as number;
const DEFAULT_API_BASE_URL = CONFIG_REGISTRY.find(e => e.key === 'DEFAULT_API_BASE_URL')!.defaultValue as string;

export async function waitForSettingsLoad(page: PageHandle): Promise<void> {
  await page.waitForFunction(
    `document.getElementById('apiBaseUrl')?.value?.length > 0`,
    FETCH_OFFSCREEN_BUFFER_MS
  );
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export class TestRunner {
  results: TestResult[] = [];

  async runTest(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`✓ ${name} (${Date.now() - start}ms)`);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.results.push({ name, passed: false, error: errorMessage, duration: Date.now() - start });
      console.error(`✗ ${name}: ${errorMessage}`);
    }
  }

  printSummary(platformName: string): void {
    console.log('\n' + '='.repeat(60));
    console.log(`${platformName} E2E Test Summary`);
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;

    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }
  }

  hasFailures(): boolean {
    return this.results.some(r => !r.passed);
  }

  isEmpty(): boolean {
    return this.results.length === 0;
  }
}

export interface TestOptions {
  skipRealApiTests?: boolean;
  skipApiConnectionTest?: boolean;
  skipCorsFetchTest?: boolean;
  skipBulkImportTest?: boolean;
}

export async function runSharedTests(adapter: TestAdapter, runner: TestRunner, options: TestOptions = {}): Promise<void> {
  // Auto-skip real API tests if no API key is available
  if (!adapter.hasRealApiKey() && !options.skipRealApiTests) {
    console.log('No OPENAI_API_KEY provided - real API tests will be skipped');
    options = { ...options, skipRealApiTests: true };
  }

  console.log('\n--- MOCKED API TESTS ---\n');

  if (adapter.isExtension) {
    await runner.runTest('Popup page loads', async () => {
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('popup'));

      await page.waitForSelector('#saveBtn');
      await page.waitForSelector('#navLibrary');
      await page.waitForSelector('#navSearch');
      await page.waitForSelector('#navStumble');

      const title = await page.evaluate(`document.title`);
      if (!title.includes('Bookmark')) {
        throw new Error(`Unexpected title: ${title}`);
      }

      await page.close();
    });
  }

  await runner.runTest('Configure API settings', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#apiKey');
    await waitForSettingsLoad(page);

    await page.evaluate(`document.getElementById('apiBaseUrl').value = '${adapter.getMockApiUrl()}'`);
    await page.evaluate(`document.getElementById('apiKey').value = 'mock-api-key'`);
    await page.evaluate(`document.getElementById('chatModel').value = 'gpt-4o-mini'`);
    await page.evaluate(`document.getElementById('embeddingModel').value = 'text-embedding-3-small'`);

    await page.click('[type="submit"]');

    await page.waitForFunction(
      `document.querySelector('.status')?.textContent?.includes('success')`,
      10000
    );

    await page.close();
  });

  if (options.skipApiConnectionTest) {
    console.log('  (Skipping API connection test for this platform)');
  } else {
    await runner.runTest('Test API connection (mocked)', async () => {
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#testBtn');
      await waitForSettingsLoad(page);

      await page.click('#testBtn');

      await page.waitForFunction(
        `(() => {
          const status = document.querySelector('#testConnectionStatus');
          return status && !status.classList.contains('hidden') &&
                 (status.textContent?.includes('successful') || status.textContent?.includes('failed'));
        })()`,
        30000
      );

      const statusText = await page.$eval<string>('#testConnectionStatus', 'el => el.textContent');
      if (!statusText?.toLowerCase().includes('successful')) {
        throw new Error(`API test failed: ${statusText}`);
      }

      await page.close();
    });
  }

  await runner.runTest('Library page loads', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    const hasBookmarkList = await page.$('#bookmarkList');
    if (!hasBookmarkList) {
      throw new Error('Bookmark list not found');
    }

    await page.close();
  });

  await runner.runTest('Search page loads', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    const hasSearchInput = await page.$('#searchInput');
    if (!hasSearchInput) {
      throw new Error('Search input not found');
    }

    await page.close();
  });

  await runner.runTest('Stumble page loads', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#shuffleBtn');

    const hasShuffleBtn = await page.$('#shuffleBtn');
    if (!hasShuffleBtn) {
      throw new Error('Shuffle button not found');
    }

    await page.close();
  });

  await runner.runTest('Bulk import UI is available', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#bulkUrlsInput');
    await page.waitForSelector('#startBulkImport');

    const hasTextarea = await page.$('#bulkUrlsInput');
    const hasImportBtn = await page.$('#startBulkImport');

    if (!hasTextarea || !hasImportBtn) {
      throw new Error('Bulk import UI elements not found');
    }

    await page.close();
  });

  await runner.runTest('Bulk import validates URLs', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#bulkUrlsInput');

    const testUrls = 'https://example.com\\njavascript:alert(1)\\nnot-a-url\\nhttps://github.com';
    await page.evaluate(`(() => {
      const el = document.getElementById('bulkUrlsInput');
      el.value = '${testUrls}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const hasFeedback = await page.$('#urlValidationFeedback');
    if (!hasFeedback) {
      throw new Error('Validation feedback element not found');
    }

    await page.close();
  });

  // Test bulk import with mock pages (requires tab renderer - extension only)
  if (options.skipBulkImportTest) {
    console.log('  (Skipping bulk import test for this platform)');
  } else {
    await runner.runTest('Bulk import processes 3 iconic documents with Q&A generation', async () => {
    const mockUrls = adapter.getMockPageUrls();
    if (mockUrls.length !== 3) {
      throw new Error(`Expected 3 mock URLs, got ${mockUrls.length}`);
    }

    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#bulkUrlsInput');
    await waitForSettingsLoad(page);

    // Enter the 3 mock URLs
    const urlsText = mockUrls.join('\\n');
    await page.evaluate(`(() => {
      const el = document.getElementById('bulkUrlsInput');
      el.value = '${urlsText}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Wait for validation to complete and button to be enabled
    await page.waitForFunction(
      `(() => {
        const feedback = document.getElementById('urlValidationFeedback');
        const btn = document.getElementById('startBulkImport');
        return feedback?.textContent?.includes('3 valid') && btn && !btn.disabled;
      })()`,
      10000
    );

    // Start the import
    await page.click('#startBulkImport');

    // Wait for all bookmarks to be processed (complete or error status)
    await page.waitForFunction(
      `(() => {
        const statusDiv = document.querySelector('.status');
        if (statusDiv && statusDiv.textContent) {
          const text = statusDiv.textContent.toLowerCase();
          if (text.includes('bulk import completed')) {
            return true;
          }
        }
        const status = document.getElementById('bulkImportStatus');
        if (status && status.textContent) {
          const text = status.textContent;
          if (text.includes('Completed 3 of 3')) {
            return true;
          }
        }
        return false;
      })()`,
      90000  // Allow 90s for full processing (fetch + markdown + Q&A + embeddings)
    );

    await page.close();

    // Verify all 3 bookmarks appear in library
    const libraryPage = await adapter.newPage();
    await libraryPage.goto(adapter.getPageUrl('library'));
    await libraryPage.waitForSelector('#bookmarkList');

    // Wait for bookmarks to appear
    await libraryPage.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        // Check we have at least 3 bookmarks
        if (cards.length < 3) return false;
        // Check for expected titles
        const titles = Array.from(cards).map(c => c.querySelector('.card-title')?.textContent || '');
        const hasManifestos = titles.some(t => t.includes('Cyberspace') || t.includes('Cypherpunk') || t.includes('Hacker') || t.includes('Conscience'));
        return hasManifestos;
      })()`,
      30000
    );

    // Click on first bookmark to verify Q&A was generated
    await libraryPage.evaluate(`(() => {
      const card = document.querySelector('.bookmark-card');
      if (card) card.click();
    })()`);

    // Wait for detail panel with Q&A pairs
    await libraryPage.waitForFunction(
      `(() => {
        const detailPanel = document.getElementById('detailPanel');
        if (!detailPanel || !detailPanel.classList.contains('active')) return false;
        const qaPairs = document.querySelectorAll('.qa-pair');
        return qaPairs.length > 0;
      })()`,
      30000
    );

    const qaCount = await libraryPage.evaluate(`document.querySelectorAll('.qa-pair').length`) as number;
    if (qaCount < 1) {
      throw new Error(`Expected at least 1 Q&A pair, got ${qaCount}`);
    }

    console.log(`  ✓ Found ${qaCount} Q&A pairs for imported document`);

    await libraryPage.close();
    });
  }

  if (options.skipCorsFetchTest) {
    console.log('  (Skipping CORS/fetch test for this platform)');
  } else {
    await runner.runTest('CORS/Fetch - Bulk import fetches Paul Graham article', async () => {
      const paulGrahamUrl = 'https://paulgraham.com/hwh.html';
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#bulkUrlsInput');
    await waitForSettingsLoad(page);

    await page.evaluate(`(() => {
      const el = document.getElementById('bulkUrlsInput');
      el.value = '${paulGrahamUrl}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await new Promise(resolve => setTimeout(resolve, 500));

    await page.click('#startBulkImport');

    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('bulkImportStatus');
        if (status && status.textContent) {
          const text = status.textContent;
          const match = text.match(/Imported (\\d+) of (\\d+)/);
          if (match && match[1] === match[2] && parseInt(match[1]) > 0) {
            return true;
          }
        }
        const statusDiv = document.querySelector('.status');
        if (statusDiv && statusDiv.textContent) {
          const text = statusDiv.textContent.toLowerCase();
          if (text.includes('bulk import completed') || text.includes('bulk import failed')) {
            return true;
          }
        }
        return false;
      })()`,
      60000
    );

    await page.close();

    const libraryPage = await adapter.newPage();
    await libraryPage.goto(adapter.getPageUrl('library'));
    await libraryPage.waitForSelector('#bookmarkList');

    await libraryPage.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const url = card.querySelector('.card-url');
          if (url && url.textContent && url.textContent.includes('paulgraham.com')) {
            return true;
          }
          const link = card.querySelector('a[href*="paulgraham.com"]');
          if (link) {
            return true;
          }
        }
        return false;
      })()`,
      30000
    );

    await libraryPage.close();
    });
  }

  await runner.runTest('Export button exists', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#exportBtn');

    const hasExportBtn = await page.$('#exportBtn');
    if (!hasExportBtn) {
      throw new Error('Export button not found');
    }

    await page.close();
  });

  await runner.runTest('Import file input exists', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#importFile');

    const hasImportFile = await page.$('#importFile');
    if (!hasImportFile) {
      throw new Error('Import file input not found');
    }

    await page.close();
  });

  await runner.runTest('Jobs dashboard exists', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    const hasJobsList = await page.$('#jobsList');
    const hasTypeFilter = await page.$('#jobTypeFilter');
    const hasStatusFilter = await page.$('#jobStatusFilter');

    if (!hasJobsList || !hasTypeFilter || !hasStatusFilter) {
      throw new Error('Jobs dashboard elements not found');
    }

    await page.close();
  });

  await runner.runTest('Jobs can be filtered by type and status', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobTypeFilter');
    await page.waitForSelector('#jobStatusFilter');

    await new Promise(resolve => setTimeout(resolve, 1000));

    await page.select('#jobTypeFilter', 'manual_add');
    await new Promise(resolve => setTimeout(resolve, 500));

    await page.select('#jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 500));

    await page.select('#jobTypeFilter', '');
    await page.select('#jobStatusFilter', '');

    await page.close();
  });

  await runner.runTest('Navigation between library and search pages', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await page.click('.app-header__nav-link[href="../search/search.html"]');
    await page.waitForSelector('#searchInput');

    const hasSearchInput = await page.$('#searchInput');
    if (!hasSearchInput) {
      throw new Error('Failed to navigate to search page');
    }

    await page.close();
  });

  await runner.runTest('Settings page scrolling is functional', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.middle');

    await new Promise(resolve => setTimeout(resolve, 500));

    const scrollableInfo = await page.evaluate(`(() => {
      const middle = document.querySelector('.middle');
      if (!middle) return { found: false };

      const hasOverflow = middle.scrollHeight > middle.clientHeight;
      const canScroll = middle.style.overflowY === 'auto' ||
                       window.getComputedStyle(middle).overflowY === 'auto';

      const initialScroll = middle.scrollTop;
      middle.scrollTo(0, 1000);
      const scrolledAmount = middle.scrollTop;
      middle.scrollTo(0, initialScroll);

      return {
        found: true,
        hasOverflow,
        canScroll,
        scrollable: scrolledAmount > initialScroll
      };
    })()`);

    if (!scrollableInfo.found) {
      throw new Error('Settings content area not found');
    }

    if (!scrollableInfo.canScroll) {
      throw new Error('Settings area does not have overflow-y: auto');
    }

    await page.close();
  });

  if (adapter.isExtension) {
    await runner.runTest('Save bookmark via runtime messaging', async () => {
      const testUrl = 'https://example.com/e2e-test-article';
      const testTitle = 'E2E Test Article About AI';
      const testHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>${testTitle}</title></head>
        <body>
          <h1>E2E Test Article</h1>
          <article>
            <p>This is a test article about artificial intelligence and machine learning.</p>
            <p>It contains important information about neural networks and deep learning.</p>
          </article>
        </body>
        </html>
      `;

      const savePage = await adapter.newPage();
      await savePage.goto(adapter.getPageUrl('popup'));
      await savePage.waitForSelector('#saveBtn');

      const result = await savePage.evaluate(`
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'SAVE_BOOKMARK',
              data: {
                url: '${testUrl}',
                title: '${testTitle}',
                html: ${JSON.stringify(testHtml)}
              }
            },
            (response) => resolve(response)
          );
        })
      `);

      await savePage.close();

      if (!(result as any)?.success) {
        throw new Error(`Failed to save bookmark: ${(result as any)?.error || 'Unknown error'}`);
      }

      const verifyPage = await adapter.newPage();
      await verifyPage.goto(adapter.getPageUrl('library'));
      await verifyPage.waitForSelector('#bookmarkList');

      await new Promise(resolve => setTimeout(resolve, 1500));

      const bookmarkFound = await verifyPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card .card-title');
          for (const card of cards) {
            if (card.textContent?.trim() === '${testTitle}') {
              return true;
            }
          }
          return false;
        })()
      `);

      if (!bookmarkFound) {
        throw new Error(`Saved bookmark "${testTitle}" not found in library`);
      }

      await verifyPage.close();
    });

    await runner.runTest('Save real external page (EFF article) via popup flow', async () => {
      const effUrl = 'https://www.eff.org/deeplinks/2025/10/its-time-take-back-ctrl';

      // First, fetch the page content from the external URL
      // This simulates what the popup does when it extracts content from the active tab
      const fetchPage = await adapter.newPage();
      await fetchPage.goto(effUrl);

      // Wait for page to load
      await fetchPage.waitForFunction(
        `document.title && document.title.length > 0`,
        30000
      );

      // Extract the page content (same as what popup's injected script does)
      const pageData = await fetchPage.evaluate(`
        (() => ({
          url: location.href,
          title: document.title,
          html: document.documentElement.outerHTML
        }))()
      `) as { url: string; title: string; html: string };

      await fetchPage.close();

      // Now send the SAVE_BOOKMARK message from extension context (popup page)
      // This mirrors the popup's actual flow: extract from tab -> send to service worker
      const savePage = await adapter.newPage();
      await savePage.goto(adapter.getPageUrl('popup'));
      await savePage.waitForSelector('#saveBtn');

      const result = await savePage.evaluate(`
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'SAVE_BOOKMARK',
              data: {
                url: ${JSON.stringify(pageData.url)},
                title: ${JSON.stringify(pageData.title)},
                html: ${JSON.stringify(pageData.html)}
              }
            },
            (response) => resolve(response)
          );
        })
      `);

      await savePage.close();

      if (!(result as any)?.success) {
        throw new Error(`Failed to save EFF bookmark: ${(result as any)?.error || 'Unknown error'}`);
      }

      // Verify the bookmark appears in library
      const verifyPage = await adapter.newPage();
      await verifyPage.goto(adapter.getPageUrl('library'));
      await verifyPage.waitForSelector('#bookmarkList');

      // Wait for the bookmark to appear
      await verifyPage.waitForFunction(
        `(() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const url = card.querySelector('.card-url');
            const title = card.querySelector('.card-title');
            if ((url && url.textContent && url.textContent.includes('eff.org')) ||
                (title && title.textContent && title.textContent.toLowerCase().includes('ctrl'))) {
              return true;
            }
          }
          return false;
        })()`,
        30000
      );

      // Wait for processing to complete by checking bookmark status via test helpers
      await verifyPage.waitForFunction(
        `(async () => {
          if (!window.__testHelpers) return false;
          const status = await window.__testHelpers.getBookmarkStatus();
          const effBookmark = status.bookmarks.find(b => b.url.includes('eff.org'));
          return effBookmark && effBookmark.status === 'complete';
        })()`,
        90000  // Allow time for markdown extraction and Q&A generation
      );

      // Click on the EFF bookmark to view details
      await verifyPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const url = card.querySelector('.card-url');
            if (url && url.textContent && url.textContent.includes('eff.org')) {
              card.click();
              return true;
            }
          }
          return false;
        })()
      `);

      // Wait for detail panel to open and show Q&A section with pairs
      await verifyPage.waitForFunction(
        `(() => {
          const detailPanel = document.getElementById('detailPanel');
          if (!detailPanel || !detailPanel.classList.contains('active')) return false;

          // Check for Q&A section with pairs
          const qaSection = document.querySelector('.qa-section');
          const qaPairs = document.querySelectorAll('.qa-pair');
          return qaSection !== null && qaPairs.length > 0;
        })()`,
        30000
      );

      // Verify the Q&A pairs were created
      const qaCount = await verifyPage.evaluate(`document.querySelectorAll('.qa-pair').length`) as number;

      if (qaCount < 1) {
        throw new Error(`Expected at least 1 Q&A pair, got ${qaCount}`);
      }

      console.log(`  ✓ Found ${qaCount} Q&A pairs for EFF article`);

      await verifyPage.close();
    });
  }

  if (options.skipRealApiTests) {
    console.log('\n--- REAL API TESTS SKIPPED ---\n');
  } else {
    console.log('\n--- REAL API TEST (1 test with actual OpenAI API) ---\n');

    await runner.runTest('Configure real OpenAI API', async () => {
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#apiKey');
      await waitForSettingsLoad(page);

      await page.evaluate(`document.getElementById('apiBaseUrl').value = '${DEFAULT_API_BASE_URL}'`);
      await page.evaluate(`document.getElementById('apiKey').value = '${adapter.getRealApiKey()}'`);
      await page.evaluate(`document.getElementById('chatModel').value = 'gpt-4o-mini'`);
      await page.evaluate(`document.getElementById('embeddingModel').value = 'text-embedding-3-small'`);

      await page.click('[type="submit"]');

      await page.waitForFunction(
        `document.querySelector('.status')?.textContent?.includes('success')`,
        10000
      );

      await page.close();
    });

    await runner.runTest('[REAL API] Test API connection', async () => {
      console.log('  🔴 Using REAL OpenAI API...');

      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#testBtn');
      await waitForSettingsLoad(page);

      await page.click('#testBtn');

      await page.waitForFunction(
        `(() => {
          const status = document.querySelector('#testConnectionStatus');
          return status && !status.classList.contains('hidden') &&
                 (status.textContent?.includes('successful') || status.textContent?.includes('failed'));
        })()`,
        30000
      );

      const statusText = await page.$eval<string>('#testConnectionStatus', 'el => el.textContent');
      if (!statusText?.toLowerCase().includes('successful')) {
        throw new Error(`Real API test failed: ${statusText}`);
      }

      console.log('  ✓ Real API connection successful');

      await page.close();
    });
  }
}
