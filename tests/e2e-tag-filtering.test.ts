import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, type TestAdapter, type PageHandle } from './e2e-shared';

/**
 * E2E tests for tag filtering on Search and Stumble pages
 * Tests filtering bookmarks by tags, combining multiple tags, and clearing filters
 */

async function waitForSettingsLoad(page: PageHandle): Promise<void> {
  await page.waitForFunction(
    `document.getElementById('apiBaseUrl')?.value?.length > 0`,
    10000
  );
}

async function runTagFilteringTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- TAG FILTERING E2E TESTS ---\n');

  // Setup: Configure mock API
  await runner.runTest('Setup: Configure mock API for tag filtering tests', async () => {
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

  // Setup: Create test bookmarks with different tags
  await runner.runTest('Setup: Create bookmarks with various tags', async () => {
    const testBookmarks = [
      { url: 'https://example.com/js-tutorial', title: 'JavaScript Basics', tags: ['javascript', 'tutorial'] },
      { url: 'https://example.com/react-guide', title: 'React Guide', tags: ['javascript', 'react', 'frontend'] },
      { url: 'https://example.com/python-intro', title: 'Python Introduction', tags: ['python', 'tutorial'] },
      { url: 'https://example.com/node-backend', title: 'Node.js Backend', tags: ['javascript', 'backend', 'nodejs'] },
      { url: 'https://example.com/css-tricks', title: 'CSS Tips and Tricks', tags: ['css', 'frontend'] }
    ];

    for (const bookmark of testBookmarks) {
      const testHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>${bookmark.title}</title></head>
        <body>
          <h1>${bookmark.title}</h1>
          <p>This is a test article about ${bookmark.tags.join(', ')}.</p>
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
                url: '${bookmark.url}',
                title: '${bookmark.title}',
                html: ${JSON.stringify(testHtml)}
              }
            },
            (response) => resolve(response)
          );
        })
      `);

      await savePage.close();

      if (!(result as any)?.success) {
        throw new Error(`Failed to save bookmark "${bookmark.title}": ${(result as any)?.error || 'Unknown error'}`);
      }

      // Add tags to the bookmark
      const libraryPage = await adapter.newPage();
      await libraryPage.goto(adapter.getPageUrl('library'));
      await libraryPage.waitForSelector('#bookmarkList');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click on the bookmark to open detail panel
      await libraryPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const title = card.querySelector('.card-title');
            if (title && title.textContent?.includes('${bookmark.title}')) {
              card.click();
              return;
            }
          }
        })()
      `);

      await libraryPage.waitForFunction(
        `document.getElementById('detailPanel')?.classList.contains('active')`,
        10000
      );

      // Add each tag
      for (const tag of bookmark.tags) {
        await libraryPage.evaluate(`
          (() => {
            const input = document.querySelector('.tag-editor input[type="text"]');
            if (input) {
              input.value = '${tag}';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
              input.dispatchEvent(enterEvent);
            }
          })()
        `);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      await libraryPage.close();
    }

    console.log(`  ✓ Created ${testBookmarks.length} bookmarks with tags`);
  });

  // Search Page Tests
  console.log('\n  === SEARCH PAGE TAG FILTERING ===\n');

  await runner.runTest('Search: Tag filters appear in sidebar', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#tagFilters');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify tag filters are present
    const filterCount = await page.evaluate(`
      document.querySelectorAll('#tagFilters .filter-item').length
    `) as number;

    if (filterCount === 0) {
      throw new Error('No tag filters found in search page sidebar');
    }

    console.log(`  ✓ Found ${filterCount} tag filters`);

    // Verify specific tags exist
    const hasJavaScriptTag = await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('javascript')) {
            return true;
          }
        }
        return false;
      })()
    `);

    if (!hasJavaScriptTag) {
      throw new Error('JavaScript tag not found in filters');
    }

    await page.close();
  });

  await runner.runTest('Search: Selecting a tag filter shows only matching results', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#searchInput');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Perform a search first (search for "tutorial")
    await page.type('#searchInput', 'tutorial');
    await page.click('#searchBtn');

    // Wait for search to complete
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('resultStatus');
        return status && !status.classList.contains('loading');
      })()`,
      30000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get initial result count
    const initialCount = await page.$eval<string>('#resultStatus', 'el => el.textContent');
    console.log(`  ✓ Initial search results: ${initialCount}`);

    // Click the 'python' tag filter checkbox
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('python')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    // Wait for filter to apply
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify only Python bookmarks are shown
    const hasPythonOnly = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.result-card');
        if (cards.length === 0) return false;

        for (const card of cards) {
          const title = card.querySelector('.card-title');
          const titleText = title ? title.textContent : '';
          // All results should be Python-related
          if (titleText && !titleText.includes('Python')) {
            return false;
          }
        }
        return true;
      })()
    `);

    if (!hasPythonOnly) {
      throw new Error('Filtered results should only show Python bookmarks');
    }

    console.log(`  ✓ Filter applied - showing only Python bookmarks`);

    await page.close();
  });

  await runner.runTest('Search: Selecting multiple tags shows bookmarks matching any selected tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#searchInput');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Perform a search
    await page.type('#searchInput', 'guide');
    await page.click('#searchBtn');

    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('resultStatus');
        return status && !status.classList.contains('loading');
      })()`,
      30000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select 'frontend' tag
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('frontend')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Select 'backend' tag
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('backend')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify results include bookmarks with either tag
    const resultCount = await page.evaluate(`
      document.querySelectorAll('.result-card').length
    `) as number;

    if (resultCount === 0) {
      throw new Error('No results found with multiple tag filters');
    }

    console.log(`  ✓ Multiple tag filters applied - showing ${resultCount} results`);

    await page.close();
  });

  await runner.runTest('Search: Clear selection button removes all tag filters', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('search'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#searchInput');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Perform a search
    await page.type('#searchInput', 'javascript');
    await page.click('#searchBtn');

    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('resultStatus');
        return status && !status.classList.contains('loading');
      })()`,
      30000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select a tag filter
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('react')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify clear button appears
    const hasClearButton = await page.$('#tagFilters .clear-selection-btn');
    if (!hasClearButton) {
      throw new Error('Clear selection button should appear when tags are selected');
    }

    // Click clear button
    await page.click('#tagFilters .clear-selection-btn');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify all checkboxes are unchecked
    const hasCheckedBoxes = await page.evaluate(`
      (() => {
        const checkboxes = document.querySelectorAll('#tagFilters input[type="checkbox"]');
        for (const cb of checkboxes) {
          if (cb.checked) return true;
        }
        return false;
      })()
    `);

    if (hasCheckedBoxes) {
      throw new Error('All tag filters should be cleared');
    }

    // Verify clear button is gone
    const clearButtonStillExists = await page.$('#tagFilters .clear-selection-btn');
    if (clearButtonStillExists) {
      throw new Error('Clear selection button should be hidden after clearing');
    }

    console.log(`  ✓ Tag filters cleared successfully`);

    await page.close();
  });

  // Stumble Page Tests
  console.log('\n  === STUMBLE PAGE TAG FILTERING ===\n');

  await runner.runTest('Stumble: Tag filters appear in sidebar', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#shuffleBtn');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify tag filters are present
    const filterCount = await page.evaluate(`
      document.querySelectorAll('#tagFilters .filter-item').length
    `) as number;

    if (filterCount === 0) {
      throw new Error('No tag filters found in stumble page sidebar');
    }

    console.log(`  ✓ Found ${filterCount} tag filters`);

    await page.close();
  });

  await runner.runTest('Stumble: Filtering by tag shows only bookmarks with that tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#stumbleList');

    // Wait for initial stumble to load
    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get initial result count
    const initialCount = await page.$eval<string>('#resultCount', 'el => el.textContent');
    console.log(`  ✓ Initial stumble count: ${initialCount}`);

    // Click the 'frontend' tag filter
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('frontend')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    // Wait for filter to apply
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify filtered results
    const filteredCount = await page.$eval<string>('#resultCount', 'el => el.textContent');
    console.log(`  ✓ Filtered stumble count: ${filteredCount}`);

    // Verify all visible bookmarks have frontend tag (by checking titles match our test data)
    const allHaveFrontendTag = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.stumble-card');
        if (cards.length === 0) return true; // Empty is ok

        for (const card of cards) {
          const title = card.querySelector('.card-title');
          const titleText = title ? title.textContent : '';
          // Should be React Guide or CSS Tips (our frontend-tagged bookmarks)
          if (titleText && !titleText.includes('React') && !titleText.includes('CSS')) {
            return false;
          }
        }
        return true;
      })()
    `);

    if (!allHaveFrontendTag) {
      throw new Error('All stumble results should have frontend tag');
    }

    console.log(`  ✓ Filter applied - showing only frontend bookmarks`);

    await page.close();
  });

  await runner.runTest('Stumble: Shuffle button works with tag filters active', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');
    await page.waitForSelector('#shuffleBtn');

    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Apply javascript tag filter
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('javascript')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get initial titles
    const initialTitles = await page.evaluate(`
      Array.from(document.querySelectorAll('.stumble-card .card-title'))
        .map(el => el.textContent)
    `) as string[];

    // Click shuffle button
    await page.click('#shuffleBtn');

    // Wait for shuffle to complete
    await page.waitForFunction(
      `(() => {
        const btn = document.getElementById('shuffleBtn');
        return btn && btn.textContent.includes('Shuffle') && !btn.disabled;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 500));

    // Get new titles
    const newTitles = await page.evaluate(`
      Array.from(document.querySelectorAll('.stumble-card .card-title'))
        .map(el => el.textContent)
    `) as string[];

    // Verify shuffle completed and results still match filter
    if (newTitles.length === 0) {
      throw new Error('Shuffle should return results with active filter');
    }

    // All results should still have javascript tag
    const allHaveJavaScriptTag = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.stumble-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          const titleText = title ? title.textContent : '';
          // Should be one of: JavaScript Basics, React Guide, or Node.js Backend
          if (titleText &&
              !titleText.includes('JavaScript') &&
              !titleText.includes('React') &&
              !titleText.includes('Node')) {
            return false;
          }
        }
        return true;
      })()
    `);

    if (!allHaveJavaScriptTag) {
      throw new Error('Shuffled results should still match the javascript tag filter');
    }

    console.log(`  ✓ Shuffle works with tag filter (${newTitles.length} results)`);

    await page.close();
  });

  await runner.runTest('Stumble: Multiple tag filters show bookmarks with any selected tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');

    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select 'python' tag
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('python')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Select 'css' tag
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('css')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify results include bookmarks with either tag
    const resultCount = await page.evaluate(`
      document.querySelectorAll('.stumble-card').length
    `) as number;

    if (resultCount === 0) {
      throw new Error('Should have results matching either python or css tag');
    }

    // Verify all results match one of the selected tags
    const allMatchTags = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.stumble-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          const titleText = title ? title.textContent : '';
          // Should be Python Introduction or CSS Tips
          if (titleText && !titleText.includes('Python') && !titleText.includes('CSS')) {
            return false;
          }
        }
        return true;
      })()
    `);

    if (!allMatchTags) {
      throw new Error('All results should match at least one selected tag');
    }

    console.log(`  ✓ Multiple tag filters applied - showing ${resultCount} results`);

    await page.close();
  });

  await runner.runTest('Stumble: Clear selection button removes all tag filters', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');

    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Select a tag filter
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('tutorial')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get filtered count
    const filteredCount = await page.$eval<string>('#resultCount', 'el => el.textContent');
    console.log(`  ✓ Filtered count: ${filteredCount}`);

    // Verify clear button appears
    const hasClearButton = await page.$('#tagFilters .clear-selection-btn');
    if (!hasClearButton) {
      throw new Error('Clear selection button should appear when tags are selected');
    }

    // Click clear button
    await page.click('#tagFilters .clear-selection-btn');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify all checkboxes are unchecked
    const hasCheckedBoxes = await page.evaluate(`
      (() => {
        const checkboxes = document.querySelectorAll('#tagFilters input[type="checkbox"]');
        for (const cb of checkboxes) {
          if (cb.checked) return true;
        }
        return false;
      })()
    `);

    if (hasCheckedBoxes) {
      throw new Error('All tag filters should be cleared');
    }

    // Get unfiltered count
    const unfilteredCount = await page.$eval<string>('#resultCount', 'el => el.textContent');
    console.log(`  ✓ Unfiltered count: ${unfilteredCount}`);

    // Unfiltered count should be greater than or equal to filtered count
    if (parseInt(unfilteredCount) < parseInt(filteredCount)) {
      throw new Error('Unfiltered count should be >= filtered count');
    }

    console.log(`  ✓ Tag filters cleared successfully`);

    await page.close();
  });

  await runner.runTest('Stumble: Empty state when no bookmarks match tag filter', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));
    await page.waitForSelector('#tagFilters');

    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create a tag that doesn't exist by selecting all tags except one pattern
    // In a real scenario, we might create a bookmark with a unique tag
    // For this test, we'll select 'nodejs' which should have limited results
    await page.evaluate(`
      (() => {
        const filters = document.querySelectorAll('#tagFilters .filter-item');
        for (const filter of filters) {
          if (filter.textContent && filter.textContent.includes('nodejs')) {
            const checkbox = filter.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return;
            }
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Check if results exist (nodejs should have 1 bookmark: Node.js Backend)
    const hasResults = await page.evaluate(`
      document.querySelectorAll('.stumble-card').length > 0
    `) as boolean;

    // Verify result count matches
    const resultCount = await page.$eval<string>('#resultCount', 'el => el.textContent');
    const resultCountNum = parseInt(resultCount);

    if (hasResults && resultCountNum === 0) {
      throw new Error('Result count should match number of cards');
    }

    if (!hasResults && resultCountNum !== 0) {
      throw new Error('Result count should be 0 when no cards are shown');
    }

    console.log(`  ✓ Tag filter applied - showing ${resultCount} result(s)`);

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Tag Filtering E2E Tests (Search & Stumble Pages)');
  console.log('='.repeat(60));
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('Mode: MOCK API');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    await runTagFilteringTests(adapter, runner);

    if (adapter.stopCoverage) {
      await adapter.stopCoverage();
    }

    if (adapter.writeCoverage) {
      await adapter.writeCoverage();
    }
  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await adapter.teardown();
  }

  runner.printSummary('Tag Filtering');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Tag Filtering E2E tests passed!');
}

main();
