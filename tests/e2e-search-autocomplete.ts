import type { TestAdapter, TestRunner } from './e2e-shared';

/**
 * E2E tests for search autocomplete/history functionality
 *
 * These tests verify:
 * - Search input field functionality
 * - Search history dropdown appearing
 * - Selecting a previous search from history
 * - Autocomplete behavior (show/hide, filtering, ordering)
 *
 * Usage: Call this function from the main test runner (e2e.test.ts, e2e-web.test.ts, etc.)
 * after runSharedTests() to include autocomplete tests.
 */
export async function runSearchAutocompleteTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- SEARCH AUTOCOMPLETE TESTS ---\n');

  await runner.runTest('Search input field is present and functional', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    const hasSearchInput = await page.$('#searchInput');
    if (!hasSearchInput) {
      throw new Error('Search input not found');
    }

    // Verify input accepts text
    await page.type('#searchInput', 'test query');
    const inputValue = await page.$eval<string>('#searchInput', 'el => el.value');
    if (inputValue !== 'test query') {
      throw new Error(`Expected input value to be 'test query', got '${inputValue}'`);
    }

    await page.close();
  });

  await runner.runTest('Autocomplete dropdown is hidden by default', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 500));

    const autocompleteState = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (autocompleteState.isVisible) {
      throw new Error('Autocomplete dropdown should be hidden on page load');
    }

    await page.close();
  });

  await runner.runTest('Search history is saved after performing a search', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers to be available
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Clear any existing search history
    await page.evaluate(`window.__testHelpers?.clearSearchHistory()`);

    // Verify history is empty
    const initialHistory = await page.evaluate(`
      window.__testHelpers?.getSearchHistory()
    `) as Array<{ query: string; resultCount: number }>;

    if (initialHistory.length !== 0) {
      throw new Error(`Expected empty search history, got ${initialHistory.length} entries`);
    }

    // Perform a search (will fail due to no embeddings, but history should still be saved)
    await page.type('#searchInput', 'artificial intelligence');
    await page.click('#searchBtn');

    // Wait for search to complete (even if it shows "no results")
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('resultStatus');
        return status && !status.classList.contains('loading');
      })()`,
      30000
    );

    // Wait a bit for history to be saved
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify history was saved
    const updatedHistory = await page.evaluate(`
      window.__testHelpers?.getSearchHistory()
    `) as Array<{ query: string; resultCount: number }>;

    if (updatedHistory.length !== 1) {
      throw new Error(`Expected 1 search history entry, got ${updatedHistory.length}`);
    }

    if (updatedHistory[0].query !== 'artificial intelligence') {
      throw new Error(`Expected query to be 'artificial intelligence', got '${updatedHistory[0].query}'`);
    }

    console.log(`  ✓ Search history saved: "${updatedHistory[0].query}" with ${updatedHistory[0].resultCount} results`);

    await page.close();
  });

  await runner.runTest('Autocomplete dropdown appears when typing and matches history', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Clear history and add some test entries
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();

        // Manually add search history entries (simulating previous searches)
        const { db } = await import('../src/db/schema');
        await db.searchHistory.bulkAdd([
          {
            id: crypto.randomUUID(),
            query: 'machine learning basics',
            resultCount: 5,
            createdAt: new Date(Date.now() - 3000)
          },
          {
            id: crypto.randomUUID(),
            query: 'deep learning tutorial',
            resultCount: 3,
            createdAt: new Date(Date.now() - 2000)
          },
          {
            id: crypto.randomUUID(),
            query: 'neural networks explained',
            resultCount: 7,
            createdAt: new Date(Date.now() - 1000)
          }
        ]);
      })()
    `);

    // Type a partial query that matches history
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'learn';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('focus', { bubbles: true }));
      })()
    `);

    // Wait for autocomplete to appear
    await new Promise(resolve => setTimeout(resolve, 300));

    const autocompleteState = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (!autocompleteState.isVisible) {
      throw new Error('Autocomplete dropdown should be visible after typing matching query');
    }

    if (autocompleteState.itemCount !== 2) {
      throw new Error(`Expected 2 autocomplete items (matching 'learn'), got ${autocompleteState.itemCount}`);
    }

    console.log(`  ✓ Autocomplete showing ${autocompleteState.itemCount} matching suggestions`);

    await page.close();
  });

  await runner.runTest('Autocomplete items display query and result count', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.add({
          id: crypto.randomUUID(),
          query: 'test autocomplete',
          resultCount: 5,
          createdAt: new Date()
        });
      })()
    `);

    // Trigger autocomplete
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'test';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify autocomplete item structure
    const autocompleteData = await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return null;

        const item = items[0];
        const query = item.querySelector('.autocomplete-query')?.textContent || '';
        const count = item.querySelector('.autocomplete-count')?.textContent || '';

        return { query, count };
      })()
    `) as { query: string; count: string } | null;

    if (!autocompleteData) {
      throw new Error('No autocomplete items found');
    }

    if (autocompleteData.query !== 'test autocomplete') {
      throw new Error(`Expected query 'test autocomplete', got '${autocompleteData.query}'`);
    }

    if (!autocompleteData.count.includes('5')) {
      throw new Error(`Expected count to include '5', got '${autocompleteData.count}'`);
    }

    console.log(`  ✓ Autocomplete item shows: "${autocompleteData.query}" (${autocompleteData.count})`);

    await page.close();
  });

  await runner.runTest('Clicking autocomplete item fills search and performs search', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.add({
          id: crypto.randomUUID(),
          query: 'previous search query',
          resultCount: 3,
          createdAt: new Date()
        });
      })()
    `);

    // Trigger autocomplete
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'prev';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify autocomplete is showing
    const beforeClick = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (!beforeClick.isVisible || beforeClick.itemCount === 0) {
      throw new Error('Autocomplete should be visible with items before clicking');
    }

    // Click the first autocomplete item
    await page.evaluate(`
      (() => {
        const item = document.querySelector('.autocomplete-item');
        if (item) item.click();
      })()
    `);

    // Wait for search to start
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('resultStatus');
        return status && status.classList.contains('loading');
      })()`,
      5000
    );

    // Verify search input was filled
    const inputValue = await page.$eval<string>('#searchInput', 'el => el.value');
    if (inputValue !== 'previous search query') {
      throw new Error(`Expected input to be 'previous search query', got '${inputValue}'`);
    }

    // Verify autocomplete is hidden
    const afterClick = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (afterClick.isVisible) {
      throw new Error('Autocomplete should be hidden after clicking item');
    }

    console.log(`  ✓ Clicked autocomplete item, search input filled and search started`);

    await page.close();
  });

  await runner.runTest('Autocomplete hides when input is cleared', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.add({
          id: crypto.randomUUID(),
          query: 'test query',
          resultCount: 2,
          createdAt: new Date()
        });
      })()
    `);

    // Show autocomplete
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'test';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify it's showing
    const beforeClear = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (!beforeClear.isVisible) {
      throw new Error('Autocomplete should be visible before clearing input');
    }

    // Clear input
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify it's hidden
    const afterClear = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (afterClear.isVisible) {
      throw new Error('Autocomplete should be hidden after clearing input');
    }

    await page.close();
  });

  await runner.runTest('Autocomplete hides when input loses focus', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.add({
          id: crypto.randomUUID(),
          query: 'focus test',
          resultCount: 1,
          createdAt: new Date()
        });
      })()
    `);

    // Show autocomplete
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'focus';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify it's showing
    const beforeBlur = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (!beforeBlur.isVisible) {
      throw new Error('Autocomplete should be visible before blur');
    }

    // Blur the input
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.blur();
      })()
    `);

    // Wait for blur handler (which has a 200ms timeout)
    await new Promise(resolve => setTimeout(resolve, 400));

    // Verify it's hidden
    const afterBlur = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    if (afterBlur.isVisible) {
      throw new Error('Autocomplete should be hidden after blur');
    }

    await page.close();
  });

  await runner.runTest('Autocomplete shows most recent searches first', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history with specific timestamps
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.bulkAdd([
          {
            id: crypto.randomUUID(),
            query: 'oldest search',
            resultCount: 1,
            createdAt: new Date(Date.now() - 3000)
          },
          {
            id: crypto.randomUUID(),
            query: 'middle search',
            resultCount: 2,
            createdAt: new Date(Date.now() - 2000)
          },
          {
            id: crypto.randomUUID(),
            query: 'newest search',
            resultCount: 3,
            createdAt: new Date(Date.now() - 1000)
          }
        ]);
      })()
    `);

    // Show autocomplete
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'search';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Get the order of autocomplete items
    const items = await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.autocomplete-item .autocomplete-query');
        return Array.from(items).map(item => item.textContent);
      })()
    `) as string[];

    if (items.length !== 3) {
      throw new Error(`Expected 3 autocomplete items, got ${items.length}`);
    }

    if (items[0] !== 'newest search') {
      throw new Error(`Expected first item to be 'newest search', got '${items[0]}'`);
    }

    if (items[2] !== 'oldest search') {
      throw new Error(`Expected last item to be 'oldest search', got '${items[2]}'`);
    }

    console.log(`  ✓ Autocomplete ordered correctly: ${items.join(' > ')}`);

    await page.close();
  });

  await runner.runTest('Autocomplete does not show exact match of current query', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#searchInput');

    // Wait for test helpers
    await page.waitForFunction(
      `window.__testHelpers && typeof window.__testHelpers.getSearchHistory === 'function'`,
      10000
    );

    // Setup history
    await page.evaluate(`
      (async () => {
        await window.__testHelpers?.clearSearchHistory();
        const { db } = await import('../src/db/schema');
        await db.searchHistory.bulkAdd([
          {
            id: crypto.randomUUID(),
            query: 'exact match query',
            resultCount: 5,
            createdAt: new Date(Date.now() - 2000)
          },
          {
            id: crypto.randomUUID(),
            query: 'exact match query partial',
            resultCount: 3,
            createdAt: new Date(Date.now() - 1000)
          }
        ]);
      })()
    `);

    // Type the exact query
    await page.evaluate(`
      (() => {
        const input = document.getElementById('searchInput');
        input.value = 'exact match query';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    const autocompleteState = await page.evaluate(`
      window.__testHelpers?.getAutocompleteState()
    `) as { isVisible: boolean; itemCount: number };

    // Should only show 1 item (the partial match), not the exact match
    if (autocompleteState.itemCount !== 1) {
      throw new Error(`Expected 1 item (excluding exact match), got ${autocompleteState.itemCount}`);
    }

    const items = await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.autocomplete-item .autocomplete-query');
        return Array.from(items).map(item => item.textContent);
      })()
    `) as string[];

    if (items[0] === 'exact match query') {
      throw new Error('Autocomplete should not show exact match of current query');
    }

    console.log(`  ✓ Autocomplete correctly excludes exact match`);

    await page.close();
  });
}
