/**
 * E2E Tests for Library Page Sorting and Tag Filtering
 *
 * Tests the sorting and tag filtering functionality in the library page, including:
 * - Sort dropdown: Newest First (default)
 * - Sort dropdown: Oldest First
 * - Sort dropdown: Title A-Z (alphabetical)
 * - Verifying bookmarks are reordered correctly after sort changes
 * - Tag list displays all tags with correct counts
 * - Filtering bookmarks by clicking on a tag
 * - Filtering by "Untagged" bookmarks
 * - Clearing tag filter by clicking "All"
 * - Combination of sorting and filtering
 * - Bookmark count updates correctly with filters
 *
 * Usage:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npm run test:e2e:library-sorting
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, PageHandle, TestAdapter } from './e2e-shared';

async function setupTestBookmarks(adapter: TestAdapter): Promise<void> {
  // Create test bookmarks with different dates, titles, and tags
  const page = await adapter.newPage();
  await page.goto(adapter.getPageUrl('library'));
  await page.waitForSelector('#bookmarkList');

  // Wait for test helpers to be available
  await page.waitForFunction(
    `window.__testHelpers`,
    10000
  );

  // Create bookmarks directly in the database via evaluate
  await page.evaluate(`
    (async () => {
      const { db } = await import('../src/db/schema.js');

      // Clear existing bookmarks for clean test
      await db.bookmarks.clear();
      await db.bookmarkTags.clear();

      const now = new Date();

      // Bookmark 1: Oldest, starts with 'A', has tags 'javascript' and 'tutorial'
      const bookmark1 = {
        id: 'test-bookmark-1',
        url: 'https://example.com/article-javascript',
        title: 'A Guide to JavaScript Basics',
        html: '<html><body>JavaScript content</body></html>',
        status: 'complete',
        createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        updatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      };
      await db.bookmarks.add(bookmark1);
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-1', tagName: 'javascript' });
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-1', tagName: 'tutorial' });

      // Bookmark 2: Middle, starts with 'Z', has tag 'python'
      const bookmark2 = {
        id: 'test-bookmark-2',
        url: 'https://example.com/article-python',
        title: 'Zen of Python Philosophy',
        html: '<html><body>Python content</body></html>',
        status: 'complete',
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        updatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      };
      await db.bookmarks.add(bookmark2);
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-2', tagName: 'python' });

      // Bookmark 3: Newest, starts with 'M', has tags 'javascript' and 'advanced'
      const bookmark3 = {
        id: 'test-bookmark-3',
        url: 'https://example.com/article-react',
        title: 'Modern React Patterns',
        html: '<html><body>React content</body></html>',
        status: 'complete',
        createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        updatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      };
      await db.bookmarks.add(bookmark3);
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-3', tagName: 'javascript' });
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-3', tagName: 'advanced' });

      // Bookmark 4: Middle-old, starts with 'B', no tags (untagged)
      const bookmark4 = {
        id: 'test-bookmark-4',
        url: 'https://example.com/article-algorithms',
        title: 'Binary Search Trees Explained',
        html: '<html><body>Algorithms content</body></html>',
        status: 'complete',
        createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      };
      await db.bookmarks.add(bookmark4);

      // Bookmark 5: Recent, starts with 'C', has tag 'tutorial'
      const bookmark5 = {
        id: 'test-bookmark-5',
        url: 'https://example.com/article-css',
        title: 'CSS Grid Layout Tutorial',
        html: '<html><body>CSS content</body></html>',
        status: 'complete',
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        updatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      };
      await db.bookmarks.add(bookmark5);
      await db.bookmarkTags.add({ bookmarkId: 'test-bookmark-5', tagName: 'tutorial' });
    })()
  `);

  await page.close();
}

async function getBookmarkTitles(page: PageHandle): Promise<string[]> {
  return await page.evaluate(`
    Array.from(document.querySelectorAll('.bookmark-card .card-title'))
      .map(el => el.textContent.trim())
  `) as string[];
}

async function getVisibleBookmarkCount(page: PageHandle): Promise<number> {
  return await page.evaluate(`
    document.querySelectorAll('.bookmark-card').length
  `) as number;
}

async function runLibrarySortingTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- LIBRARY SORTING AND TAG FILTERING TESTS ---\n');

  // Setup test data
  console.log('Setting up test bookmarks...');
  await setupTestBookmarks(adapter);
  console.log('✓ Test bookmarks created');

  await runner.runTest('Library page loads with all bookmarks', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');
    await page.waitForSelector('#sortSelect');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    const count = await getVisibleBookmarkCount(page);
    if (count !== 5) {
      throw new Error(`Expected 5 bookmarks, found ${count}`);
    }

    const bookmarkCountText = await page.$eval<string>('#bookmarkCount', 'el => el.textContent');
    if (bookmarkCountText !== '5') {
      throw new Error(`Expected bookmark count to be 5, got ${bookmarkCountText}`);
    }

    await page.close();
  });

  await runner.runTest('Sort by Newest First (default)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Verify default sort is "newest"
    const selectedValue = await page.$eval<string>('#sortSelect', 'el => el.value');
    if (selectedValue !== 'newest') {
      throw new Error(`Expected default sort to be 'newest', got '${selectedValue}'`);
    }

    const titles = await getBookmarkTitles(page);

    // Expected order: Modern React (1 day) -> CSS Grid (2 days) -> Zen of Python (3 days) -> Binary Search (5 days) -> A Guide (7 days)
    const expectedOrder = [
      'Modern React Patterns',
      'CSS Grid Layout Tutorial',
      'Zen of Python Philosophy',
      'Binary Search Trees Explained',
      'A Guide to JavaScript Basics'
    ];

    if (JSON.stringify(titles) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Incorrect sort order. Expected: ${JSON.stringify(expectedOrder)}, Got: ${JSON.stringify(titles)}`);
    }

    await page.close();
  });

  await runner.runTest('Sort by Oldest First', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#sortSelect');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Change sort to oldest
    await page.select('#sortSelect', 'oldest');

    // Wait for UI to update
    await new Promise(resolve => setTimeout(resolve, 500));

    const titles = await getBookmarkTitles(page);

    // Expected order: A Guide (7 days) -> Binary Search (5 days) -> Zen of Python (3 days) -> CSS Grid (2 days) -> Modern React (1 day)
    const expectedOrder = [
      'A Guide to JavaScript Basics',
      'Binary Search Trees Explained',
      'Zen of Python Philosophy',
      'CSS Grid Layout Tutorial',
      'Modern React Patterns'
    ];

    if (JSON.stringify(titles) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Incorrect sort order. Expected: ${JSON.stringify(expectedOrder)}, Got: ${JSON.stringify(titles)}`);
    }

    await page.close();
  });

  await runner.runTest('Sort by Title (A-Z)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#sortSelect');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Change sort to title
    await page.select('#sortSelect', 'title');

    // Wait for UI to update
    await new Promise(resolve => setTimeout(resolve, 500));

    const titles = await getBookmarkTitles(page);

    // Expected order: A -> B -> C -> M -> Z (alphabetically)
    const expectedOrder = [
      'A Guide to JavaScript Basics',
      'Binary Search Trees Explained',
      'CSS Grid Layout Tutorial',
      'Modern React Patterns',
      'Zen of Python Philosophy'
    ];

    if (JSON.stringify(titles) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Incorrect sort order. Expected: ${JSON.stringify(expectedOrder)}, Got: ${JSON.stringify(titles)}`);
    }

    await page.close();
  });

  await runner.runTest('Switch between sort options preserves filters', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#sortSelect');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Start with newest
    await page.select('#sortSelect', 'newest');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Switch to oldest
    await page.select('#sortSelect', 'oldest');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Switch to title
    await page.select('#sortSelect', 'title');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Switch back to newest
    await page.select('#sortSelect', 'newest');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify we still have all 5 bookmarks
    const count = await getVisibleBookmarkCount(page);
    if (count !== 5) {
      throw new Error(`Expected 5 bookmarks after sort changes, found ${count}`);
    }

    await page.close();
  });

  await runner.runTest('Tag list displays all tags with counts', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    const tagInfo = await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .map(el => ({
          name: el.querySelector('.tag-name')?.textContent?.trim() || '',
          count: parseInt(el.querySelector('.tag-count')?.textContent?.trim() || '0')
        }))
    `) as Array<{ name: string; count: number }>;

    // Verify 'All' tag exists with count of 5
    const allTag = tagInfo.find(t => t.name === 'All');
    if (!allTag || allTag.count !== 5) {
      throw new Error(`Expected 'All' tag with count 5, got ${JSON.stringify(allTag)}`);
    }

    // Verify 'Untagged' exists with count of 1
    const untaggedTag = tagInfo.find(t => t.name === 'Untagged');
    if (!untaggedTag || untaggedTag.count !== 1) {
      throw new Error(`Expected 'Untagged' tag with count 1, got ${JSON.stringify(untaggedTag)}`);
    }

    // Verify individual tags
    const javascriptTag = tagInfo.find(t => t.name === '#javascript');
    if (!javascriptTag || javascriptTag.count !== 2) {
      throw new Error(`Expected '#javascript' tag with count 2, got ${JSON.stringify(javascriptTag)}`);
    }

    const tutorialTag = tagInfo.find(t => t.name === '#tutorial');
    if (!tutorialTag || tutorialTag.count !== 2) {
      throw new Error(`Expected '#tutorial' tag with count 2, got ${JSON.stringify(tutorialTag)}`);
    }

    const pythonTag = tagInfo.find(t => t.name === '#python');
    if (!pythonTag || pythonTag.count !== 1) {
      throw new Error(`Expected '#python' tag with count 1, got ${JSON.stringify(pythonTag)}`);
    }

    const advancedTag = tagInfo.find(t => t.name === '#advanced');
    if (!advancedTag || advancedTag.count !== 1) {
      throw new Error(`Expected '#advanced' tag with count 1, got ${JSON.stringify(advancedTag)}`);
    }

    await page.close();
  });

  await runner.runTest('Filter by tag - javascript', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    // Click on the 'javascript' tag
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('javascript'))
        ?.click()
    `);

    // Wait for bookmarks to filter
    await new Promise(resolve => setTimeout(resolve, 500));

    const count = await getVisibleBookmarkCount(page);
    if (count !== 2) {
      throw new Error(`Expected 2 bookmarks with 'javascript' tag, found ${count}`);
    }

    const titles = await getBookmarkTitles(page);

    // Should show: Modern React Patterns and A Guide to JavaScript Basics
    const hasReact = titles.includes('Modern React Patterns');
    const hasGuide = titles.includes('A Guide to JavaScript Basics');

    if (!hasReact || !hasGuide) {
      throw new Error(`Expected javascript-tagged bookmarks, got ${JSON.stringify(titles)}`);
    }

    // Verify the tag is marked as active
    const isActive = await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('javascript'))
        ?.classList.contains('active')
    `);

    if (!isActive) {
      throw new Error('Expected javascript tag to be marked as active');
    }

    await page.close();
  });

  await runner.runTest('Filter by tag - python', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    // Click on the 'python' tag
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('python'))
        ?.click()
    `);

    // Wait for bookmarks to filter
    await new Promise(resolve => setTimeout(resolve, 500));

    const count = await getVisibleBookmarkCount(page);
    if (count !== 1) {
      throw new Error(`Expected 1 bookmark with 'python' tag, found ${count}`);
    }

    const titles = await getBookmarkTitles(page);
    if (titles[0] !== 'Zen of Python Philosophy') {
      throw new Error(`Expected 'Zen of Python Philosophy', got ${titles[0]}`);
    }

    await page.close();
  });

  await runner.runTest('Filter by tag - tutorial', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    // Click on the 'tutorial' tag
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('tutorial'))
        ?.click()
    `);

    // Wait for bookmarks to filter
    await new Promise(resolve => setTimeout(resolve, 500));

    const count = await getVisibleBookmarkCount(page);
    if (count !== 2) {
      throw new Error(`Expected 2 bookmarks with 'tutorial' tag, found ${count}`);
    }

    const titles = await getBookmarkTitles(page);

    // Should show: CSS Grid Layout Tutorial and A Guide to JavaScript Basics
    const hasCSS = titles.includes('CSS Grid Layout Tutorial');
    const hasGuide = titles.includes('A Guide to JavaScript Basics');

    if (!hasCSS || !hasGuide) {
      throw new Error(`Expected tutorial-tagged bookmarks, got ${JSON.stringify(titles)}`);
    }

    await page.close();
  });

  await runner.runTest('Filter by Untagged', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    // Click on the 'Untagged' tag
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent === 'Untagged')
        ?.click()
    `);

    // Wait for bookmarks to filter
    await new Promise(resolve => setTimeout(resolve, 500));

    const count = await getVisibleBookmarkCount(page);
    if (count !== 1) {
      throw new Error(`Expected 1 untagged bookmark, found ${count}`);
    }

    const titles = await getBookmarkTitles(page);
    if (titles[0] !== 'Binary Search Trees Explained') {
      throw new Error(`Expected 'Binary Search Trees Explained', got ${titles[0]}`);
    }

    await page.close();
  });

  await runner.runTest('Clear filter by clicking All', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    // Wait for tags to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0`,
      10000
    );

    // First, filter by javascript
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('javascript'))
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify filtered
    let count = await getVisibleBookmarkCount(page);
    if (count !== 2) {
      throw new Error(`Expected 2 bookmarks after filtering, found ${count}`);
    }

    // Now click 'All' to clear filter
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent === 'All')
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify all bookmarks are shown again
    count = await getVisibleBookmarkCount(page);
    if (count !== 5) {
      throw new Error(`Expected 5 bookmarks after clearing filter, found ${count}`);
    }

    // Verify 'All' is marked as active
    const isActive = await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent === 'All')
        ?.classList.contains('active')
    `);

    if (!isActive) {
      throw new Error('Expected All tag to be marked as active');
    }

    await page.close();
  });

  await runner.runTest('Sorting works with tag filtering', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');
    await page.waitForSelector('#sortSelect');

    // Wait for everything to load
    await page.waitForFunction(
      `document.querySelectorAll('#tagList .tag-item').length > 0 &&
       document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Filter by 'javascript' tag
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('javascript'))
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify we have 2 javascript bookmarks
    let count = await getVisibleBookmarkCount(page);
    if (count !== 2) {
      throw new Error(`Expected 2 javascript bookmarks, found ${count}`);
    }

    // Sort by title
    await page.select('#sortSelect', 'title');
    await new Promise(resolve => setTimeout(resolve, 500));

    let titles = await getBookmarkTitles(page);

    // Expected: A Guide to JavaScript Basics, Modern React Patterns (alphabetical)
    let expectedOrder = [
      'A Guide to JavaScript Basics',
      'Modern React Patterns'
    ];

    if (JSON.stringify(titles) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Incorrect filtered+sorted order. Expected: ${JSON.stringify(expectedOrder)}, Got: ${JSON.stringify(titles)}`);
    }

    // Now sort by newest
    await page.select('#sortSelect', 'newest');
    await new Promise(resolve => setTimeout(resolve, 500));

    titles = await getBookmarkTitles(page);

    // Expected: Modern React Patterns (1 day), A Guide to JavaScript Basics (7 days)
    expectedOrder = [
      'Modern React Patterns',
      'A Guide to JavaScript Basics'
    ];

    if (JSON.stringify(titles) !== JSON.stringify(expectedOrder)) {
      throw new Error(`Incorrect filtered+sorted order. Expected: ${JSON.stringify(expectedOrder)}, Got: ${JSON.stringify(titles)}`);
    }

    // Verify count is still 2 (filter preserved)
    count = await getVisibleBookmarkCount(page);
    if (count !== 2) {
      throw new Error(`Expected 2 bookmarks after sort change, found ${count}`);
    }

    await page.close();
  });

  await runner.runTest('Bookmark count updates when filtering', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkCount');
    await page.waitForSelector('#tagList');

    // Wait for initial load
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length >= 5`,
      10000
    );

    // Initial count should be 5
    let countText = await page.$eval<string>('#bookmarkCount', 'el => el.textContent');
    if (countText !== '5') {
      throw new Error(`Expected initial count of 5, got ${countText}`);
    }

    // Filter by python
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('python'))
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Count should be 1
    countText = await page.$eval<string>('#bookmarkCount', 'el => el.textContent');
    if (countText !== '1') {
      throw new Error(`Expected count of 1 after python filter, got ${countText}`);
    }

    // Filter by javascript
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent?.includes('javascript'))
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Count should be 2
    countText = await page.$eval<string>('#bookmarkCount', 'el => el.textContent');
    if (countText !== '2') {
      throw new Error(`Expected count of 2 after javascript filter, got ${countText}`);
    }

    // Clear filter
    await page.evaluate(`
      Array.from(document.querySelectorAll('#tagList .tag-item'))
        .find(el => el.querySelector('.tag-name')?.textContent === 'All')
        ?.click()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Count should be 5 again
    countText = await page.$eval<string>('#bookmarkCount', 'el => el.textContent');
    if (countText !== '5') {
      throw new Error(`Expected count of 5 after clearing filter, got ${countText}`);
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Library Sorting & Tag Filtering E2E Tests (Chrome)');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    await runLibrarySortingTests(adapter, runner);

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

  runner.printSummary('Library Sorting & Tag Filtering');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Library sorting and tag filtering tests passed!');
}

main();
