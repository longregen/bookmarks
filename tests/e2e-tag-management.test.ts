import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, PageHandle } from './e2e-shared';

async function waitForSettingsLoad(page: PageHandle): Promise<void> {
  await page.waitForFunction(
    `document.getElementById('apiBaseUrl')?.value?.length > 0`,
    10000
  );
}

async function runTagManagementTests(adapter: ChromeAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- TAG MANAGEMENT E2E TESTS ---\n');

  // Setup: Configure API settings with mock
  await runner.runTest('Setup: Configure mock API for tag tests', async () => {
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

  // Setup: Create a test bookmark
  let testBookmarkId: string | null = null;

  await runner.runTest('Setup: Create test bookmark for tagging', async () => {
    const testUrl = 'https://example.com/tag-test-article';
    const testTitle = 'Tag Test Article';
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>${testTitle}</title></head>
      <body>
        <h1>Tag Test Article</h1>
        <p>This is a test article for tag management testing.</p>
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
      throw new Error(`Failed to save test bookmark: ${(result as any)?.error || 'Unknown error'}`);
    }

    // Get the bookmark ID by navigating to library and finding it
    const libraryPage = await adapter.newPage();
    await libraryPage.goto(adapter.getPageUrl('library'));
    await libraryPage.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    const bookmarkData = await libraryPage.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            // Card has the bookmark in a data attribute or we can extract from onclick
            return { found: true };
          }
        }
        return { found: false };
      })()
    `);

    if (!(bookmarkData as any).found) {
      throw new Error('Test bookmark not found in library');
    }

    await libraryPage.close();
  });

  await runner.runTest('Tag Editor: Opens detail panel and shows tag editor', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    // Wait for detail panel to open
    await page.waitForFunction(
      `(() => {
        const detailPanel = document.getElementById('detailPanel');
        return detailPanel && detailPanel.classList.contains('active');
      })()`,
      10000
    );

    // Verify tag editor is present
    const hasTagEditor = await page.evaluate(`
      (() => {
        const tagEditor = document.querySelector('.tag-editor');
        const tagInput = document.querySelector('.tag-editor input[type="text"]');
        return tagEditor !== null && tagInput !== null;
      })()
    `);

    if (!hasTagEditor) {
      throw new Error('Tag editor not found in detail panel');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Add a new tag by typing and pressing Enter', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark to open detail panel
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Type a tag and press Enter
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'javascript';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          input.dispatchEvent(enterEvent);
        }
      })()
    `);

    // Wait for tag to appear
    await page.waitForFunction(
      `(() => {
        const pills = document.querySelectorAll('.tag-pill');
        for (const pill of pills) {
          if (pill.textContent && pill.textContent.includes('javascript')) {
            return true;
          }
        }
        return false;
      })()`,
      10000
    );

    // Verify tag pill has remove button
    const hasRemoveButton = await page.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.tag-pill');
        for (const pill of pills) {
          if (pill.textContent && pill.textContent.includes('javascript')) {
            const removeBtn = pill.querySelector('button');
            return removeBtn !== null && removeBtn.textContent === '×';
          }
        }
        return false;
      })()
    `);

    if (!hasRemoveButton) {
      throw new Error('Tag pill does not have remove button');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Add multiple tags', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Add second tag
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'tutorial';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          input.dispatchEvent(enterEvent);
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Add third tag
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'beginner';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          input.dispatchEvent(enterEvent);
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify all three tags are present
    const tagCount = await page.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.tag-pill');
        const tags = Array.from(pills).map(pill => pill.textContent || '');
        const hasJavascript = tags.some(t => t.includes('javascript'));
        const hasTutorial = tags.some(t => t.includes('tutorial'));
        const hasBeginner = tags.some(t => t.includes('beginner'));
        return hasJavascript && hasTutorial && hasBeginner ? pills.length : 0;
      })()
    `);

    if ((tagCount as number) < 3) {
      throw new Error(`Expected at least 3 tags, found ${tagCount}`);
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Remove a tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Wait for tags to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get initial tag count
    const initialTagCount = await page.evaluate(`
      document.querySelectorAll('.tag-pill').length
    `);

    // Click the remove button on the 'tutorial' tag
    await page.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.tag-pill');
        for (const pill of pills) {
          if (pill.textContent && pill.textContent.includes('tutorial')) {
            const removeBtn = pill.querySelector('button');
            if (removeBtn) {
              removeBtn.click();
              return;
            }
          }
        }
      })()
    `);

    // Wait for tag to be removed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify tag count decreased
    const finalTagCount = await page.evaluate(`
      document.querySelectorAll('.tag-pill').length
    `);

    if ((finalTagCount as number) !== (initialTagCount as number) - 1) {
      throw new Error(`Tag was not removed. Initial: ${initialTagCount}, Final: ${finalTagCount}`);
    }

    // Verify 'tutorial' tag is gone
    const hasTutorialTag = await page.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.tag-pill');
        for (const pill of pills) {
          if (pill.textContent && pill.textContent.includes('tutorial')) {
            return true;
          }
        }
        return false;
      })()
    `);

    if (hasTutorialTag) {
      throw new Error('Tutorial tag was not removed');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Autocomplete shows suggestions while typing', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Type partial tag name to trigger autocomplete
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'java';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Wait for dropdown to appear
    await page.waitForFunction(
      `(() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return dropdown && dropdown.style.display === 'block';
      })()`,
      5000
    );

    // Verify dropdown has items
    const hasDropdownItems = await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.tag-dropdown-item');
        return items.length > 0;
      })()
    `);

    if (!hasDropdownItems) {
      throw new Error('Autocomplete dropdown does not show any items');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Autocomplete shows "Create" option for new tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Type a unique tag name that doesn't exist
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'unique-new-tag-xyz';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Wait for dropdown to appear
    await page.waitForFunction(
      `(() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return dropdown && dropdown.style.display === 'block';
      })()`,
      5000
    );

    // Verify "Create" option exists
    const hasCreateOption = await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.tag-dropdown-item');
        for (const item of items) {
          if (item.textContent && item.textContent.toLowerCase().includes('create')) {
            return true;
          }
        }
        return false;
      })()
    `);

    if (!hasCreateOption) {
      throw new Error('Autocomplete dropdown does not show "Create" option for new tag');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Click autocomplete suggestion to add tag', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Type to show autocomplete with existing 'javascript' tag
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'java';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Wait for dropdown
    await page.waitForFunction(
      `(() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return dropdown && dropdown.style.display === 'block';
      })()`,
      5000
    );

    await new Promise(resolve => setTimeout(resolve, 500));

    // Click on the 'javascript' suggestion (if it exists and isn't already applied)
    await page.evaluate(`
      (() => {
        const items = document.querySelectorAll('.tag-dropdown-item');
        for (const item of items) {
          if (item.textContent && item.textContent.includes('javascript')) {
            item.click();
            return;
          }
        }
        // If javascript not in dropdown, click Create option
        for (const item of items) {
          if (item.textContent && item.textContent.toLowerCase().includes('create')) {
            item.click();
            return;
          }
        }
      })()
    `);

    // Wait for tag to be added
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify dropdown is hidden after selection
    const isDropdownHidden = await page.evaluate(`
      (() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return !dropdown || dropdown.style.display === 'none';
      })()
    `);

    if (!isDropdownHidden) {
      throw new Error('Dropdown should be hidden after selecting a tag');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Tags are normalized (lowercase, hyphenated)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Add a tag with uppercase and spaces
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'My New Tag';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          input.dispatchEvent(enterEvent);
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify tag is normalized to 'my-new-tag'
    const hasNormalizedTag = await page.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.tag-pill');
        for (const pill of pills) {
          if (pill.textContent && pill.textContent.includes('my-new-tag')) {
            return true;
          }
        }
        return false;
      })()
    `);

    if (!hasNormalizedTag) {
      throw new Error('Tag was not normalized to lowercase with hyphens');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Tags appear in library view', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Look for tag badges on the bookmark card
    const hasTagBadges = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            const badges = card.querySelectorAll('.tag-badge');
            return badges.length > 0;
          }
        }
        return false;
      })()
    `);

    if (!hasTagBadges) {
      throw new Error('Tags do not appear as badges in library view');
    }

    await page.close();
  });

  await runner.runTest('Tag Editor: Dropdown hides when clicking outside', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the test bookmark
    await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        for (const card of cards) {
          const title = card.querySelector('.card-title');
          if (title && title.textContent?.includes('Tag Test Article')) {
            card.click();
            return;
          }
        }
      })()
    `);

    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Type to show dropdown
    await page.evaluate(`
      (() => {
        const input = document.querySelector('.tag-editor input[type="text"]');
        if (input) {
          input.value = 'test';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);

    // Wait for dropdown to appear
    await page.waitForFunction(
      `(() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return dropdown && dropdown.style.display === 'block';
      })()`,
      5000
    );

    // Click outside the input area (on the detail panel title)
    await page.evaluate(`
      (() => {
        const title = document.querySelector('#detailContent h1');
        if (title) {
          title.click();
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify dropdown is hidden
    const isDropdownHidden = await page.evaluate(`
      (() => {
        const dropdown = document.querySelector('.tag-dropdown');
        return !dropdown || dropdown.style.display === 'none';
      })()
    `);

    if (!isDropdownHidden) {
      throw new Error('Dropdown should hide when clicking outside');
    }

    await page.close();
  });

  await runner.runTest('Tag Filter: Tags appear in sidebar tag list', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify tag list has tags
    const hasTagsInSidebar = await page.evaluate(`
      (() => {
        const tagItems = document.querySelectorAll('#tagList .tag-item');
        // Should have at least 'All' and some actual tags
        return tagItems.length >= 2;
      })()
    `);

    if (!hasTagsInSidebar) {
      throw new Error('Tags do not appear in sidebar tag list');
    }

    await page.close();
  });

  await runner.runTest('Tag Filter: Clicking a tag filters bookmarks', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#tagList');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Click on the 'javascript' tag in the sidebar
    await page.evaluate(`
      (() => {
        const tagItems = document.querySelectorAll('#tagList .tag-item');
        for (const item of tagItems) {
          const tagName = item.querySelector('.tag-name');
          if (tagName && tagName.textContent && tagName.textContent.includes('javascript')) {
            item.click();
            return;
          }
        }
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify the tag is marked as active
    const isTagActive = await page.evaluate(`
      (() => {
        const tagItems = document.querySelectorAll('#tagList .tag-item');
        for (const item of tagItems) {
          const tagName = item.querySelector('.tag-name');
          if (tagName && tagName.textContent && tagName.textContent.includes('javascript')) {
            return item.classList.contains('active');
          }
        }
        return false;
      })()
    `);

    if (!isTagActive) {
      throw new Error('Clicked tag should be marked as active');
    }

    // Verify bookmarks are filtered (all visible bookmarks should have the javascript tag)
    const allHaveTag = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card');
        if (cards.length === 0) return false;

        for (const card of cards) {
          const badges = card.querySelectorAll('.tag-badge');
          let hasJavascriptTag = false;
          for (const badge of badges) {
            if (badge.textContent && badge.textContent.includes('javascript')) {
              hasJavascriptTag = true;
              break;
            }
          }
          if (!hasJavascriptTag) {
            return false;
          }
        }
        return true;
      })()
    `);

    if (!allHaveTag) {
      throw new Error('Not all filtered bookmarks have the javascript tag');
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Tag Management E2E Tests');
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

    await runTagManagementTests(adapter, runner);

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

  runner.printSummary(adapter.platformName);

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Tag Management E2E tests passed!');
}

main();
