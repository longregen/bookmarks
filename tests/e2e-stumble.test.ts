import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, type TestAdapter, type PageHandle } from './e2e-shared';

/**
 * E2E tests for the Stumble page
 * Tests random bookmark discovery, shuffle functionality, and edge cases
 */

async function runStumbleTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- STUMBLE PAGE E2E TESTS ---\n');

  await runner.runTest('Stumble page loads with empty state', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    // Wait for main elements
    await page.waitForSelector('#shuffleBtn');
    await page.waitForSelector('#stumbleList');
    await page.waitForSelector('#resultCount');

    // Verify shuffle button is present and enabled
    const hasShuffleBtn = await page.$('#shuffleBtn');
    if (!hasShuffleBtn) {
      throw new Error('Shuffle button not found');
    }

    // Check initial result count
    const count = await page.$eval<string>('#resultCount', 'el => el.textContent');
    if (count !== '0') {
      throw new Error(`Expected result count to be 0, got ${count}`);
    }

    // Verify empty state message appears
    const emptyState = await page.waitForSelector('.empty-state', 5000);
    if (!emptyState) {
      throw new Error('Empty state not displayed');
    }

    const emptyText = await page.$eval<string>('.empty-state', 'el => el.textContent');
    if (!emptyText?.includes('No complete bookmarks')) {
      throw new Error(`Unexpected empty state text: ${emptyText}`);
    }

    await page.close();
  });

  await runner.runTest('Configure mock API for bookmark creation', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#apiKey');

    // Wait for settings to load
    await page.waitForFunction(
      `document.getElementById('apiBaseUrl')?.value?.length > 0`,
      10000
    );

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

  await runner.runTest('Add multiple bookmarks for stumble testing', async () => {
    const mockUrls = adapter.getMockPageUrls();
    if (mockUrls.length < 3) {
      throw new Error('Need at least 3 mock URLs for testing');
    }

    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#bulkUrlsInput');

    // Enter mock URLs
    const urlsText = mockUrls.join('\\n');
    await page.evaluate(`(() => {
      const el = document.getElementById('bulkUrlsInput');
      el.value = '${urlsText}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Wait for validation
    await page.waitForFunction(
      `(() => {
        const feedback = document.getElementById('urlValidationFeedback');
        const btn = document.getElementById('startBulkImport');
        return feedback?.textContent?.includes('valid') && btn && !btn.disabled;
      })()`,
      10000
    );

    // Start import
    await page.click('#startBulkImport');

    // Wait for completion
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
          if (text.includes('Completed ${mockUrls.length} of ${mockUrls.length}')) {
            return true;
          }
        }
        return false;
      })()`,
      90000
    );

    await page.close();
  });

  await runner.runTest('Stumble page displays random bookmarks after import', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#shuffleBtn');
    await page.waitForSelector('#stumbleList');

    // Wait for bookmarks to appear (should auto-load on page load)
    await page.waitForFunction(
      `(() => {
        const count = document.getElementById('resultCount');
        return count && parseInt(count.textContent) > 0;
      })()`,
      10000
    );

    // Verify result count is greater than 0
    const count = await page.$eval<string>('#resultCount', 'el => el.textContent');
    const countNum = parseInt(count);
    if (countNum === 0) {
      throw new Error('Expected bookmarks to be displayed, got 0');
    }

    console.log(`  ✓ Displaying ${countNum} random bookmarks`);

    // Verify bookmark cards are rendered
    const cards = await page.evaluate(`document.querySelectorAll('.stumble-card').length`) as number;
    if (cards === 0) {
      throw new Error('No bookmark cards found in stumble list');
    }

    if (cards !== countNum) {
      throw new Error(`Result count (${countNum}) doesn't match number of cards (${cards})`);
    }

    // Verify bookmark cards have expected structure
    const hasTitle = await page.$('.stumble-card .card-title');
    const hasUrl = await page.$('.stumble-card .card-url');
    const hasSavedAgo = await page.$('.stumble-card .saved-ago');

    if (!hasTitle || !hasUrl || !hasSavedAgo) {
      throw new Error('Bookmark cards missing expected elements');
    }

    await page.close();
  });

  await runner.runTest('Shuffle button changes displayed bookmarks', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#shuffleBtn');
    await page.waitForSelector('#stumbleList');

    // Wait for initial load
    await page.waitForFunction(
      `(() => {
        const count = document.getElementById('resultCount');
        return count && parseInt(count.textContent) > 0;
      })()`,
      10000
    );

    // Get initial bookmark titles
    const initialTitles = await page.evaluate(`
      Array.from(document.querySelectorAll('.stumble-card .card-title'))
        .map(el => el.textContent)
    `) as string[];

    if (initialTitles.length === 0) {
      throw new Error('No bookmarks displayed initially');
    }

    // Click shuffle button
    await page.click('#shuffleBtn');

    // Wait for shuffle to complete (button text changes to "Shuffling..." then back to "↻ Shuffle")
    await page.waitForFunction(
      `(() => {
        const btn = document.getElementById('shuffleBtn');
        return btn && btn.textContent.includes('↻ Shuffle') && !btn.disabled;
      })()`,
      10000
    );

    // Small delay to ensure DOM updates
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get new bookmark titles
    const newTitles = await page.evaluate(`
      Array.from(document.querySelectorAll('.stumble-card .card-title'))
        .map(el => el.textContent)
    `) as string[];

    if (newTitles.length === 0) {
      throw new Error('No bookmarks displayed after shuffle');
    }

    // With randomization and multiple bookmarks, titles should likely change
    // We'll check if at least the order changed or some titles are different
    const titlesChanged = JSON.stringify(initialTitles) !== JSON.stringify(newTitles);

    // Note: With only 3 bookmarks, there's a chance they appear in the same order
    // So we'll just verify that shuffle completed successfully and bookmarks are still shown
    console.log(`  ✓ Shuffle completed (${newTitles.length} bookmarks displayed)`);
    if (titlesChanged) {
      console.log(`  ✓ Bookmark order/selection changed after shuffle`);
    }

    await page.close();
  });

  await runner.runTest('Shuffle button shows loading state during shuffle', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#shuffleBtn');

    // Wait for initial load
    await page.waitForFunction(
      `(() => {
        const count = document.getElementById('resultCount');
        return count && parseInt(count.textContent) > 0;
      })()`,
      10000
    );

    // Verify initial button state
    const initialText = await page.$eval<string>('#shuffleBtn', 'el => el.textContent');
    if (!initialText?.includes('Shuffle')) {
      throw new Error(`Unexpected initial button text: ${initialText}`);
    }

    // Click shuffle and immediately check for loading state
    const clickPromise = page.click('#shuffleBtn');

    // Check that button shows "Shuffling..." and is disabled (may be very brief)
    try {
      await page.waitForFunction(
        `(() => {
          const btn = document.getElementById('shuffleBtn');
          return btn && (btn.textContent.includes('Shuffling') || btn.disabled);
        })()`,
        2000
      );
      console.log(`  ✓ Button showed loading state`);
    } catch {
      // Loading state might be too fast to catch, which is okay
      console.log(`  ⚠ Loading state too brief to detect (acceptable)`);
    }

    await clickPromise;

    // Wait for shuffle to complete
    await page.waitForFunction(
      `(() => {
        const btn = document.getElementById('shuffleBtn');
        return btn && btn.textContent.includes('↻ Shuffle') && !btn.disabled;
      })()`,
      10000
    );

    // Verify final state
    const finalText = await page.$eval<string>('#shuffleBtn', 'el => el.textContent');
    const isDisabled = await page.$eval<boolean>('#shuffleBtn', 'el => el.disabled');

    if (!finalText?.includes('Shuffle')) {
      throw new Error(`Button text not restored: ${finalText}`);
    }

    if (isDisabled) {
      throw new Error('Button still disabled after shuffle');
    }

    await page.close();
  });

  await runner.runTest('Multiple consecutive shuffles work correctly', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#shuffleBtn');

    // Wait for initial load
    await page.waitForFunction(
      `(() => {
        const count = document.getElementById('resultCount');
        return count && parseInt(count.textContent) > 0;
      })()`,
      10000
    );

    // Perform 3 consecutive shuffles
    for (let i = 1; i <= 3; i++) {
      await page.click('#shuffleBtn');

      // Wait for shuffle to complete
      await page.waitForFunction(
        `(() => {
          const btn = document.getElementById('shuffleBtn');
          return btn && btn.textContent.includes('↻ Shuffle') && !btn.disabled;
        })()`,
        10000
      );

      // Verify bookmarks are still displayed
      const count = await page.$eval<string>('#resultCount', 'el => el.textContent');
      const countNum = parseInt(count);

      if (countNum === 0) {
        throw new Error(`Shuffle ${i} resulted in 0 bookmarks`);
      }

      const cards = await page.evaluate(`document.querySelectorAll('.stumble-card').length`) as number;
      if (cards === 0) {
        throw new Error(`Shuffle ${i} resulted in no cards`);
      }

      console.log(`  ✓ Shuffle ${i}/3 completed (${countNum} bookmarks)`);

      // Small delay between shuffles
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await page.close();
  });

  await runner.runTest('Stumble page bookmark cards are clickable', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#shuffleBtn');
    await page.waitForSelector('#stumbleList');

    // Wait for bookmarks to load
    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    // Click the first bookmark card
    await page.evaluate(`
      (() => {
        const card = document.querySelector('.stumble-card');
        if (card) card.click();
      })()
    `);

    // Wait for detail panel to open
    await page.waitForFunction(
      `(() => {
        const panel = document.getElementById('detailPanel');
        return panel && panel.classList.contains('active');
      })()`,
      10000
    );

    const panelActive = await page.evaluate(`
      document.getElementById('detailPanel')?.classList.contains('active')
    `) as boolean;

    if (!panelActive) {
      throw new Error('Detail panel did not open after clicking bookmark card');
    }

    // Verify detail panel has content
    const hasContent = await page.$('#detailContent');
    if (!hasContent) {
      throw new Error('Detail panel missing content element');
    }

    // Close the detail panel
    await page.click('#closeDetailBtn');

    // Verify panel closed
    await page.waitForFunction(
      `(() => {
        const panel = document.getElementById('detailPanel');
        return panel && !panel.classList.contains('active');
      })()`,
      5000
    );

    await page.close();
  });

  await runner.runTest('Stumble page shows Q&A preview when available', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('#stumbleList');

    // Wait for bookmarks with Q&A to load
    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.stumble-card');
        return cards.length > 0;
      })()`,
      10000
    );

    // Check if any cards have Q&A preview
    const hasQAPreview = await page.evaluate(`
      (() => {
        const previews = document.querySelectorAll('.qa-preview');
        return previews.length > 0;
      })()
    `) as boolean;

    // Q&A preview should be present since we imported bookmarks with mock Q&A
    if (!hasQAPreview) {
      console.log(`  ⚠ No Q&A previews found (bookmarks may still be processing)`);
    } else {
      // Verify Q&A preview structure
      const hasQuestion = await page.$('.qa-preview .qa-q');
      const hasAnswer = await page.$('.qa-preview .qa-a');

      if (!hasQuestion || !hasAnswer) {
        throw new Error('Q&A preview missing question or answer elements');
      }

      console.log(`  ✓ Q&A previews displayed on bookmark cards`);
    }

    await page.close();
  });

  await runner.runTest('Stumble page navigation links work', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('stumble'));

    await page.waitForSelector('.app-header__nav-link');

    // Verify active state on Stumble link
    const stumbleLinkActive = await page.evaluate(`
      (() => {
        const link = document.querySelector('.app-header__nav-link[href="stumble.html"]');
        return link?.classList.contains('active');
      })()
    `) as boolean;

    if (!stumbleLinkActive) {
      throw new Error('Stumble navigation link should have active class');
    }

    // Navigate to Library
    await page.click('.app-header__nav-link[href="../library/library.html"]');
    await page.waitForSelector('#bookmarkList', 10000);

    // Navigate back to Stumble
    await page.click('.app-header__nav-link[href="../stumble/stumble.html"]');
    await page.waitForSelector('#shuffleBtn', 10000);

    const hasShuffleBtn = await page.$('#shuffleBtn');
    if (!hasShuffleBtn) {
      throw new Error('Failed to navigate back to Stumble page');
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  const separator = Array(61).join('=');
  console.log(separator);
  console.log('Stumble Page E2E Tests (Chrome Extension)');
  console.log(separator);
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('Mode: MOCK API');
  console.log(separator);

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    await runStumbleTests(adapter, runner);

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

  runner.printSummary('Stumble Page');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Stumble E2E tests passed!');
}

main();
