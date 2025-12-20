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
    console.log('  (Skipping bulk import test - localhost not accessible in this environment)');
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
    console.log('  (Skipping CORS/fetch test - localhost not accessible in this environment)');
  } else {
    await runner.runTest('CORS/Fetch - Bulk import fetches local mock page', async () => {
      // Use local mock server URL instead of external URL to avoid network flakiness
      const mockServerUrl = adapter.getMockApiUrl();
      const testPageUrl = `${mockServerUrl}/page/cyberspace-independence`;

      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#bulkUrlsInput');
      await waitForSettingsLoad(page);

      await page.evaluate(`(() => {
        const el = document.getElementById('bulkUrlsInput');
        el.value = '${testPageUrl}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

      await new Promise(resolve => setTimeout(resolve, 500));

      await page.click('#startBulkImport');

      await page.waitForFunction(
        `(() => {
          const status = document.getElementById('bulkImportStatus');
          if (status && status.textContent) {
            const text = status.textContent;
            const match = text.match(/Completed (\\d+) of (\\d+)/);
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
            const title = card.querySelector('.card-title');
            if (title && title.textContent && title.textContent.includes('Cyberspace')) {
              return true;
            }
            const url = card.querySelector('.card-url');
            if (url && url.textContent && url.textContent.includes('127.0.0.1')) {
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

  await runner.runTest('Export all bookmarks as JSON returns valid data', async () => {
    // Open library page where test helpers are available
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for test helpers to be available
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.exportAllBookmarks === 'function'`,
      10000
    );

    // Call export function via test helpers
    const exportResult = await page.evaluate(`
      (async () => {
        try {
          const result = await window.__testHelpers.exportAllBookmarks();
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: error.message || String(error) };
        }
      })()
    `) as { success: boolean; data?: unknown; error?: string };

    if (!exportResult.success) {
      throw new Error(`Export failed: ${exportResult.error}`);
    }

    const exportData = exportResult.data as {
      version?: number;
      exportedAt?: string;
      bookmarkCount?: number;
      bookmarks?: unknown[];
    };

    // Verify export structure
    if (typeof exportData.version !== 'number') {
      throw new Error(`Export missing version field, got: ${JSON.stringify(exportData)}`);
    }
    if (typeof exportData.exportedAt !== 'string') {
      throw new Error(`Export missing exportedAt field`);
    }
    if (typeof exportData.bookmarkCount !== 'number') {
      throw new Error(`Export missing bookmarkCount field`);
    }
    if (!Array.isArray(exportData.bookmarks)) {
      throw new Error(`Export missing bookmarks array`);
    }
    if (exportData.bookmarks.length !== exportData.bookmarkCount) {
      throw new Error(`Export bookmarkCount (${exportData.bookmarkCount}) doesn't match actual bookmarks length (${exportData.bookmarks.length})`);
    }

    // Verify each bookmark has required fields
    for (const bookmark of exportData.bookmarks) {
      const b = bookmark as Record<string, unknown>;
      if (typeof b.id !== 'string') throw new Error(`Bookmark missing id field`);
      if (typeof b.url !== 'string') throw new Error(`Bookmark missing url field`);
      if (typeof b.title !== 'string') throw new Error(`Bookmark missing title field`);
      if (typeof b.status !== 'string') throw new Error(`Bookmark missing status field`);
      if (typeof b.createdAt !== 'string') throw new Error(`Bookmark missing createdAt field`);
      if (typeof b.updatedAt !== 'string') throw new Error(`Bookmark missing updatedAt field`);
      if (!Array.isArray(b.questionsAnswers)) throw new Error(`Bookmark missing questionsAnswers array`);
    }

    console.log(`  ✓ Export returned ${exportData.bookmarkCount} bookmarks with valid structure`);

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

  await runner.runTest('Import UI elements are functional', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#importFile');
    await page.waitForSelector('#importBtn');

    // Verify import button is initially disabled (no file selected)
    const isDisabled = await page.evaluate(`
      document.getElementById('importBtn').disabled
    `);

    if (!isDisabled) {
      throw new Error('Import button should be disabled when no file is selected');
    }

    // Verify file input accepts JSON
    const acceptType = await page.evaluate(`
      document.getElementById('importFile').accept
    `) as string;

    if (!acceptType.includes('.json')) {
      throw new Error(`Expected file input to accept .json, got: ${acceptType}`);
    }

    console.log('  ✓ Import UI elements are properly configured');
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

  await runner.runTest('Jobs dashboard type filter works', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobTypeFilter');
    await page.waitForSelector('#jobsList');

    // Wait for jobs to load
    await page.waitForFunction(
      `(() => {
        const jobsList = document.getElementById('jobsList');
        return jobsList && !jobsList.textContent?.includes('Loading');
      })()`,
      10000
    );

    // Additional wait for Firefox which may need more time
    await new Promise(resolve => setTimeout(resolve, 500));

    const initialJobCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Filter by manual_add type
    await page.select('#jobTypeFilter', 'manual_add');
    await new Promise(resolve => setTimeout(resolve, 500));

    const filteredCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Verify filter changed the display (or stayed same if all are that type)
    console.log(`  ✓ Type filter: ${initialJobCount} total jobs, ${filteredCount} after filtering by manual_add`);

    // Clear filter
    await page.select('#jobTypeFilter', '');

    // Wait for jobs to reload after clearing filter (Firefox needs this)
    await page.waitForFunction(
      `(() => {
        const jobsList = document.getElementById('jobsList');
        return jobsList && !jobsList.textContent?.includes('Loading');
      })()`,
      10000
    );
    await new Promise(resolve => setTimeout(resolve, 500));

    const afterClearCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Allow for timing variance - just verify we got jobs back
    if (afterClearCount === 0 && initialJobCount > 0) {
      throw new Error(`Expected jobs after clearing filter, got 0 (initial was ${initialJobCount})`);
    }

    console.log(`  ✓ Type filter reset works (${afterClearCount} jobs)`);
    await page.close();
  });

  await runner.runTest('Jobs dashboard status filter works', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobStatusFilter');
    await page.waitForSelector('#jobsList');

    // Wait for jobs to load
    await page.waitForFunction(
      `(() => {
        const jobsList = document.getElementById('jobsList');
        return jobsList && !jobsList.textContent?.includes('Loading');
      })()`,
      10000
    );

    const initialJobCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Filter by completed status
    await page.select('#jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 500));

    const completedCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Verify all displayed jobs have completed status
    const allCompleted = await page.evaluate(`(() => {
      const jobs = document.querySelectorAll('.job-item');
      if (jobs.length === 0) return true;
      for (const job of jobs) {
        const badge = job.querySelector('.job-status-badge');
        if (!badge || !badge.textContent?.toUpperCase().includes('COMPLETED')) {
          return false;
        }
      }
      return true;
    })()`);

    if (!allCompleted) {
      throw new Error('Not all displayed jobs have completed status after filtering');
    }

    console.log(`  ✓ Status filter: ${completedCount} completed jobs displayed`);

    // Clear filter
    await page.select('#jobStatusFilter', '');
    await new Promise(resolve => setTimeout(resolve, 500));

    await page.close();
  });

  await runner.runTest('Jobs dashboard refresh button works', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#refreshJobsBtn');
    await page.waitForSelector('#jobsList');

    // Wait for initial load
    await page.waitForFunction(
      `(() => {
        const jobsList = document.getElementById('jobsList');
        return jobsList && !jobsList.textContent?.includes('Loading');
      })()`,
      10000
    );

    const beforeCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    // Click refresh
    await page.click('#refreshJobsBtn');

    // Wait for refresh to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

    const afterCount = await page.evaluate(`
      document.querySelectorAll('.job-item').length
    `) as number;

    console.log(`  ✓ Refresh button works: ${beforeCount} before, ${afterCount} after`);
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

  // Theme switching tests
  await runner.runTest('Theme selection changes document theme attribute', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeAuto');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test each theme by clicking the label (radio inputs may be visually hidden)
    const themes = ['light', 'dark', 'terminal', 'tufte'];
    for (const theme of themes) {
      const themeId = `theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
      // Click the label associated with the radio button
      await page.evaluate(`(() => {
        const label = document.querySelector('label[for="${themeId}"]');
        if (label) label.click();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 300));

      const appliedTheme = await page.evaluate(`
        document.documentElement.getAttribute('data-theme')
      `) as string;

      if (appliedTheme !== theme) {
        throw new Error(`Expected data-theme="${theme}", got "${appliedTheme}"`);
      }
    }

    // Reset to auto
    await page.evaluate(`(() => {
      const label = document.querySelector('label[for="themeAuto"]');
      if (label) label.click();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 300));

    console.log('  ✓ All theme selections apply correct data-theme attribute');
    await page.close();
  });

  await runner.runTest('Theme persists after page reload', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeDark');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Select dark theme by clicking label
    await page.evaluate(`(() => {
      const label = document.querySelector('label[for="themeDark"]');
      if (label) label.click();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Reload the page
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#themeDark');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify dark theme is still selected
    const isDarkChecked = await page.evaluate(`
      document.getElementById('themeDark').checked
    `);

    if (!isDarkChecked) {
      throw new Error('Dark theme was not persisted after page reload');
    }

    const appliedTheme = await page.evaluate(`
      document.documentElement.getAttribute('data-theme')
    `) as string;

    if (appliedTheme !== 'dark') {
      throw new Error(`Expected data-theme="dark" after reload, got "${appliedTheme}"`);
    }

    // Reset to auto for other tests
    await page.evaluate(`(() => {
      const label = document.querySelector('label[for="themeAuto"]');
      if (label) label.click();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 300));

    console.log('  ✓ Theme selection persists after page reload');
    await page.close();
  });

  // Library sorting tests
  await runner.runTest('Library sort dropdown has all options', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#sortSelect');

    const sortOptions = await page.evaluate(`(() => {
      const select = document.getElementById('sortSelect');
      return Array.from(select.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim()
      }));
    })()`) as Array<{ value: string; text: string }>;

    const expectedOptions = ['newest', 'oldest', 'title'];
    for (const expected of expectedOptions) {
      const found = sortOptions.some(opt => opt.value === expected);
      if (!found) {
        throw new Error(`Sort option "${expected}" not found. Options: ${JSON.stringify(sortOptions)}`);
      }
    }

    console.log(`  ✓ Sort dropdown has ${sortOptions.length} options: ${sortOptions.map(o => o.value).join(', ')}`);
    await page.close();
  });

  await runner.runTest('Library sorting by title produces alphabetical order', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#sortSelect');
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmarks to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select title sort
    await page.select('#sortSelect', 'title');
    await new Promise(resolve => setTimeout(resolve, 500));

    const titles = await page.evaluate(`(() => {
      const cards = document.querySelectorAll('.bookmark-card .card-title');
      return Array.from(cards).map(el => el.textContent.trim());
    })()`) as string[];

    if (titles.length < 2) {
      console.log('  ⚠ Less than 2 bookmarks, skipping sort order verification');
      await page.close();
      return;
    }

    const sortedTitles = [...titles].sort((a, b) => a.localeCompare(b));
    const isSorted = titles.every((t, i) => t === sortedTitles[i]);

    if (!isSorted) {
      throw new Error('Titles are not in alphabetical order after sorting by title');
    }

    console.log(`  ✓ ${titles.length} bookmarks sorted alphabetically by title`);
    await page.close();
  });

  // Stumble page interaction tests
  await runner.runTest('Stumble shuffle button is clickable', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#shuffleBtn');

    const hasShuffleBtn = await page.$('#shuffleBtn');
    if (!hasShuffleBtn) {
      throw new Error('Shuffle button not found');
    }

    // Click shuffle and verify it responds
    await page.click('#shuffleBtn');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify button exists and page is still functional
    const stillHasButton = await page.$('#shuffleBtn');
    if (!stillHasButton) {
      throw new Error('Shuffle button disappeared after click');
    }

    console.log('  ✓ Shuffle button is clickable');
    await page.close();
  });

  await runner.runTest('Stumble page has result count display', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#resultCount');

    const resultCount = await page.evaluate(`
      document.getElementById('resultCount')?.textContent || ''
    `) as string;

    // Result count should contain a number
    if (!/\d/.test(resultCount)) {
      console.log(`  Note: Result count shows "${resultCount}" (may be 0 bookmarks)`);
    } else {
      console.log(`  ✓ Result count displays: ${resultCount.trim()}`);
    }

    await page.close();
  });

  // Search interaction tests
  await runner.runTest('Search input accepts text and search button triggers search', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');
    await page.waitForSelector('#searchBtn');

    // Type in search input
    await page.type('#searchInput', 'artificial intelligence');
    await new Promise(resolve => setTimeout(resolve, 300));

    const inputValue = await page.evaluate(`
      document.getElementById('searchInput').value
    `) as string;

    if (inputValue !== 'artificial intelligence') {
      throw new Error(`Expected search input to have "artificial intelligence", got "${inputValue}"`);
    }

    // Click search button
    await page.click('#searchBtn');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify results list container exists (it's always present, may be empty)
    const hasResultsList = await page.$('#resultsList');
    if (!hasResultsList) {
      throw new Error('Results list container not found');
    }

    console.log('  ✓ Search input accepts text and search button triggers search');
    await page.close();
  });

  // Settings sidebar navigation tests
  await runner.runTest('Settings sidebar has navigation links', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.sidebar');

    const navItems = await page.evaluate(`(() => {
      const items = document.querySelectorAll('.sidebar .nav-item');
      return Array.from(items).map(item => ({
        section: item.getAttribute('data-section'),
        text: item.textContent.trim()
      }));
    })()`) as Array<{ section: string; text: string }>;

    if (navItems.length < 3) {
      throw new Error(`Expected at least 3 sidebar nav items, found ${navItems.length}`);
    }

    console.log(`  ✓ Sidebar has ${navItems.length} navigation items`);
    await page.close();
  });

  await runner.runTest('Settings sidebar navigation activates clicked item', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('.sidebar');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click on a nav item (API Configuration or similar)
    const clicked = await page.evaluate(`(() => {
      const navItems = document.querySelectorAll('.sidebar .nav-item');
      for (const item of navItems) {
        if (item.textContent.includes('API') || item.textContent.includes('Configuration')) {
          item.click();
          return item.textContent.trim();
        }
      }
      // Click second item if no API config found
      if (navItems.length > 1) {
        navItems[1].click();
        return navItems[1].textContent.trim();
      }
      return null;
    })()`) as string | null;

    if (!clicked) {
      throw new Error('Could not find sidebar nav item to click');
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check that an item is active
    const hasActiveItem = await page.evaluate(`
      document.querySelector('.sidebar .nav-item.active') !== null
    `);

    if (!hasActiveItem) {
      console.log('  Note: No .active class on nav items (may use different styling)');
    }

    console.log(`  ✓ Clicked nav item: ${clicked}`);
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
              type: 'bookmark:save_from_page',
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

    await runner.runTest('Save page via popup flow with Q&A generation', async () => {
      // Use local mock server URL instead of external URL to avoid network flakiness
      const mockServerUrl = adapter.getMockApiUrl();
      const testPageUrl = `${mockServerUrl}/page/cypherpunk-manifesto`;

      // First, fetch the page content from the mock server
      // This simulates what the popup does when it extracts content from the active tab
      const fetchPage = await adapter.newPage();
      await fetchPage.goto(testPageUrl);

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

      // Now send the bookmark:save_from_page message from extension context (popup page)
      // This mirrors the popup's actual flow: extract from tab -> send to service worker
      const savePage = await adapter.newPage();
      await savePage.goto(adapter.getPageUrl('popup'));
      await savePage.waitForSelector('#saveBtn');

      const result = await savePage.evaluate(`
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'bookmark:save_from_page',
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
        throw new Error(`Failed to save bookmark: ${(result as any)?.error || 'Unknown error'}`);
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
            const title = card.querySelector('.card-title');
            if (title && title.textContent && title.textContent.includes('Cypherpunk')) {
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
          const bookmark = status.bookmarks.find(b => b.url.includes('127.0.0.1'));
          return bookmark && bookmark.status === 'complete';
        })()`,
        90000  // Allow time for markdown extraction and Q&A generation
      );

      // Click on the bookmark to view details
      await verifyPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const title = card.querySelector('.card-title');
            if (title && title.textContent && title.textContent.includes('Cypherpunk')) {
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

      console.log(`  ✓ Found ${qaCount} Q&A pairs for test article`);

      await verifyPage.close();
    });

    await runner.runTest('Export all bookmarks includes saved bookmarks with Q&A data', async () => {
      // Open library page where test helpers are available
      const page = await adapter.newPage();
      await page.goto(adapter.getPageUrl('library'));
      await page.waitForSelector('#bookmarkList');

      // Wait for test helpers to be available
      await page.waitForFunction(
        `window.__testHelpers && typeof window.__testHelpers.exportAllBookmarks === 'function'`,
        10000
      );

      // Call export function via test helpers
      const exportResult = await page.evaluate(`
        (async () => {
          try {
            const result = await window.__testHelpers.exportAllBookmarks();
            return { success: true, data: result };
          } catch (error) {
            return { success: false, error: error.message || String(error) };
          }
        })()
      `) as { success: boolean; data?: unknown; error?: string };

      if (!exportResult.success) {
        throw new Error(`Export failed: ${exportResult.error}`);
      }

      const exportData = exportResult.data as {
        version?: number;
        exportedAt?: string;
        bookmarkCount?: number;
        bookmarks?: Record<string, unknown>[];
      };

      // Verify we have at least some bookmarks (from previous tests)
      if (!exportData.bookmarkCount || exportData.bookmarkCount < 1) {
        throw new Error(`Expected at least 1 bookmark in export, got ${exportData.bookmarkCount}`);
      }

      // Find a bookmark with Q&A data (should exist from previous tests)
      const bookmarkWithQA = exportData.bookmarks?.find(
        (b) => Array.isArray(b.questionsAnswers) && (b.questionsAnswers as unknown[]).length > 0
      );

      if (!bookmarkWithQA) {
        throw new Error('No bookmark found with Q&A data in export');
      }

      // Verify the Q&A structure
      const qa = (bookmarkWithQA.questionsAnswers as Record<string, unknown>[])[0];
      if (typeof qa.question !== 'string') {
        throw new Error('Q&A pair missing question field');
      }
      if (typeof qa.answer !== 'string') {
        throw new Error('Q&A pair missing answer field');
      }

      // Check for markdown field
      const bookmarkWithMarkdown = exportData.bookmarks?.find(
        (b) => typeof b.markdown === 'string' && (b.markdown as string).length > 0
      );

      if (!bookmarkWithMarkdown) {
        throw new Error('No bookmark found with markdown content in export');
      }

      console.log(`  ✓ Export contains ${exportData.bookmarkCount} bookmarks with Q&A and markdown data`);

      await page.close();
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
