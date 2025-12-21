import { TestAdapter, TestRunner } from './e2e-shared';

/**
 * Detail Panel E2E Tests
 * Tests for detail panel actions: opening, retry, export, delete (confirm/cancel)
 */
export async function runDetailPanelTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- DETAIL PANEL ACTION TESTS ---\n');

  await runner.runTest('Detail panel opens when clicking bookmark card', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for at least one bookmark card to appear
    await page.waitForFunction(
      `(() => {
        const cards = document.querySelectorAll('.bookmark-card');
        return cards.length > 0;
      })()`,
      30000
    );

    // Click on first bookmark card
    await page.evaluate(`
      (() => {
        const card = document.querySelector('.bookmark-card');
        if (card) card.click();
      })()
    `);

    // Wait for detail panel to open
    await page.waitForFunction(
      `(() => {
        const panel = document.getElementById('detailPanel');
        const backdrop = document.getElementById('detailBackdrop');
        return panel && panel.classList.contains('active') &&
               backdrop && backdrop.classList.contains('active');
      })()`,
      10000
    );

    // Verify detail panel buttons are present
    const hasCloseBtn = await page.$('#closeDetailBtn');
    const hasDeleteBtn = await page.$('#deleteBtn');
    const hasExportBtn = await page.$('#exportBtn');
    const hasDebugBtn = await page.$('#debugBtn');

    if (!hasCloseBtn || !hasDeleteBtn || !hasExportBtn || !hasDebugBtn) {
      throw new Error('Detail panel buttons not found');
    }

    await page.close();
  });

  await runner.runTest('Detail panel close button works', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Click close button
    await page.click('#closeDetailBtn');

    // Verify detail panel is closed
    await page.waitForFunction(
      `(() => {
        const panel = document.getElementById('detailPanel');
        const backdrop = document.getElementById('detailBackdrop');
        return panel && !panel.classList.contains('active') &&
               backdrop && !backdrop.classList.contains('active');
      })()`,
      10000
    );

    await page.close();
  });

  await runner.runTest('Detail panel backdrop click closes panel', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Click backdrop
    await page.click('#detailBackdrop');

    // Verify detail panel is closed
    await page.waitForFunction(
      `!document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    await page.close();
  });

  await runner.runTest('Export button exports single bookmark', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Verify export button is present and enabled
    const exportBtnDisabled = await page.$eval<boolean>(
      '#exportBtn',
      'el => el.disabled'
    );

    if (exportBtnDisabled) {
      throw new Error('Export button is disabled');
    }

    // Click export button
    await page.click('#exportBtn');

    // Wait for export button to change to "Exporting..."
    await page.waitForFunction(
      `document.getElementById('exportBtn')?.textContent?.includes('Exporting')`,
      5000
    );

    // Wait for export to complete (button text returns to "Export")
    await page.waitForFunction(
      `(() => {
        const btn = document.getElementById('exportBtn');
        return btn && btn.textContent === 'Export' && !btn.disabled;
      })()`,
      15000
    );

    console.log('  ✓ Export button triggered successfully');

    await page.close();
  });

  await runner.runTest('Debug button shows bookmark debug info', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Set up alert handler to capture and verify alert is shown
    const alertShown = await page.evaluate(`
      (async () => {
        return new Promise((resolve) => {
          const originalAlert = window.alert;
          let alertCalled = false;
          window.alert = function(msg) {
            alertCalled = true;
            // Verify alert contains expected debug info
            if (msg.includes('HTML Length') && msg.includes('Status')) {
              resolve(true);
            } else {
              resolve(false);
            }
            window.alert = originalAlert;
          };

          // Click debug button
          document.getElementById('debugBtn').click();

          // If no alert after 1 second, something went wrong
          setTimeout(() => {
            if (!alertCalled) {
              window.alert = originalAlert;
              resolve(false);
            }
          }, 1000);
        });
      })()
    `);

    if (!alertShown) {
      throw new Error('Debug alert was not shown or did not contain expected info');
    }

    console.log('  ✓ Debug button showed bookmark info');

    await page.close();
  });

  await runner.runTest('Delete button with cancellation does not delete bookmark', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Get initial bookmark count
    const initialCount = await page.$eval<number>(
      '#bookmarkCount',
      'el => parseInt(el.textContent || "0", 10)'
    );

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    // Get the title of the bookmark we're clicking
    const bookmarkTitle = await page.evaluate(`
      document.querySelector('.bookmark-card .card-title')?.textContent
    `) as string;

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Set up confirm handler to cancel deletion
    await page.evaluate(`
      window.confirm = () => false;
    `);

    // Click delete button
    await page.click('#deleteBtn');

    // Wait a moment for potential deletion (which shouldn't happen)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify detail panel is still open (deletion was cancelled)
    const panelStillActive = await page.evaluate(`
      document.getElementById('detailPanel')?.classList.contains('active')
    `) as boolean;

    if (!panelStillActive) {
      throw new Error('Detail panel closed even though deletion was cancelled');
    }

    // Close the panel
    await page.click('#closeDetailBtn');

    // Wait for panel to close
    await page.waitForFunction(
      `!document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Verify bookmark count is unchanged
    const finalCount = await page.$eval<number>(
      '#bookmarkCount',
      'el => parseInt(el.textContent || "0", 10)'
    );

    if (finalCount !== initialCount) {
      throw new Error(`Bookmark count changed from ${initialCount} to ${finalCount} even though deletion was cancelled`);
    }

    // Verify the bookmark still exists in the list
    const bookmarkStillExists = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card .card-title');
        for (const card of cards) {
          if (card.textContent === '${bookmarkTitle}') {
            return true;
          }
        }
        return false;
      })()
    `) as boolean;

    if (!bookmarkStillExists) {
      throw new Error('Bookmark was deleted even though deletion was cancelled');
    }

    console.log('  ✓ Bookmark deletion was cancelled successfully');

    await page.close();
  });

  await runner.runTest('Delete button with confirmation deletes bookmark', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('library'));
    await page.waitForSelector('#bookmarkList');

    // Get initial bookmark count
    const initialCount = await page.$eval<number>(
      '#bookmarkCount',
      'el => parseInt(el.textContent || "0", 10)'
    );

    if (initialCount === 0) {
      throw new Error('No bookmarks available for deletion test');
    }

    // Wait for bookmark card and click it
    await page.waitForFunction(
      `document.querySelectorAll('.bookmark-card').length > 0`,
      30000
    );

    // Get the title of the bookmark we're deleting
    const bookmarkTitle = await page.evaluate(`
      document.querySelector('.bookmark-card .card-title')?.textContent
    `) as string;

    await page.evaluate(`document.querySelector('.bookmark-card').click()`);

    // Wait for detail panel to open
    await page.waitForFunction(
      `document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Set up confirm handler to accept deletion
    await page.evaluate(`
      window.confirm = () => true;
    `);

    // Click delete button
    await page.click('#deleteBtn');

    // Wait for detail panel to close (deletion confirmed)
    await page.waitForFunction(
      `!document.getElementById('detailPanel')?.classList.contains('active')`,
      10000
    );

    // Wait for bookmark list to refresh
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify bookmark count decreased
    const finalCount = await page.$eval<number>(
      '#bookmarkCount',
      'el => parseInt(el.textContent || "0", 10)'
    );

    if (finalCount !== initialCount - 1) {
      throw new Error(`Expected bookmark count to decrease from ${initialCount} to ${initialCount - 1}, got ${finalCount}`);
    }

    // Verify the bookmark no longer exists in the list
    const bookmarkStillExists = await page.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.bookmark-card .card-title');
        for (const card of cards) {
          if (card.textContent === '${bookmarkTitle}') {
            return true;
          }
        }
        return false;
      })()
    `) as boolean;

    if (bookmarkStillExists) {
      throw new Error('Bookmark still exists in list after deletion');
    }

    console.log(`  ✓ Bookmark deleted successfully (count: ${initialCount} → ${finalCount})`);

    await page.close();
  });

  if (adapter.isExtension) {
    await runner.runTest('Retry button appears for error status bookmarks', async () => {
      // First, create a bookmark with error status
      const testUrl = 'https://example.com/error-test-bookmark';
      const testTitle = 'Error Test Bookmark';
      const testHtml = '<html><body><h1>Error Test</h1></body></html>';

      const savePage = await adapter.newPage();
      await savePage.goto(adapter.getPageUrl('popup'));
      await savePage.waitForSelector('#saveBtn');

      // Save the bookmark
      await savePage.evaluate(`
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

      // Now manually set the bookmark to error status using test helpers
      const libraryPage = await adapter.newPage();
      await libraryPage.goto(adapter.getPageUrl('library'));
      await libraryPage.waitForSelector('#bookmarkList');

      // Wait for test helpers to be available
      await libraryPage.waitForFunction(
        `window.__testHelpers && typeof window.__testHelpers.getBookmarkStatus === 'function'`,
        10000
      );

      // Find the bookmark ID and set it to error status
      await libraryPage.evaluate(`
        (async () => {
          const { db } = await import('../src/db/schema');
          const bookmark = await db.bookmarks.where('url').equals('${testUrl}').first();
          if (bookmark) {
            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: 'Test error message'
            });
          }
        })()
      `);

      // Refresh the page to see the error status
      await libraryPage.goto(adapter.getPageUrl('library'));
      await libraryPage.waitForSelector('#bookmarkList');

      // Find and click the error bookmark
      await libraryPage.waitForFunction(
        `(() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const title = card.querySelector('.card-title');
            const statusDot = card.querySelector('.status-dot');
            if (title && title.textContent === '${testTitle}' &&
                statusDot && statusDot.classList.contains('status-dot--error')) {
              return true;
            }
          }
          return false;
        })()`,
        30000
      );

      await libraryPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const title = card.querySelector('.card-title');
            if (title && title.textContent === '${testTitle}') {
              card.click();
              return;
            }
          }
        })()
      `);

      // Wait for detail panel to open
      await libraryPage.waitForFunction(
        `document.getElementById('detailPanel')?.classList.contains('active')`,
        10000
      );

      // Verify retry button is visible
      await libraryPage.waitForFunction(
        `(() => {
          const retryBtn = document.getElementById('retryBtn');
          return retryBtn && retryBtn.style.display !== 'none';
        })()`,
        10000
      );

      // Verify error message is displayed
      const errorMessageVisible = await libraryPage.evaluate(`
        (() => {
          const detailContent = document.getElementById('detailContent');
          if (!detailContent) return false;
          return detailContent.textContent?.includes('Test error message');
        })()
      `) as boolean;

      if (!errorMessageVisible) {
        throw new Error('Error message not displayed in detail panel');
      }

      console.log('  ✓ Retry button visible for error status bookmark');

      await libraryPage.close();
    });

    await runner.runTest('Retry button triggers bookmark retry', async () => {
      const libraryPage = await adapter.newPage();
      await libraryPage.goto(adapter.getPageUrl('library'));
      await libraryPage.waitForSelector('#bookmarkList');

      // Find and click an error bookmark (from previous test)
      await libraryPage.waitForFunction(
        `(() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const statusDot = card.querySelector('.status-dot');
            if (statusDot && statusDot.classList.contains('status-dot--error')) {
              return true;
            }
          }
          return false;
        })()`,
        30000
      );

      await libraryPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const statusDot = card.querySelector('.status-dot');
            if (statusDot && statusDot.classList.contains('status-dot--error')) {
              card.click();
              return;
            }
          }
        })()
      `);

      // Wait for detail panel to open
      await libraryPage.waitForFunction(
        `document.getElementById('detailPanel')?.classList.contains('active')`,
        10000
      );

      // Wait for retry button to be visible
      await libraryPage.waitForFunction(
        `(() => {
          const retryBtn = document.getElementById('retryBtn');
          return retryBtn && retryBtn.style.display !== 'none' && !retryBtn.disabled;
        })()`,
        10000
      );

      // Click retry button
      await libraryPage.click('#retryBtn');

      // Wait for retry button to show "Retrying..." state
      await libraryPage.waitForFunction(
        `document.getElementById('retryBtn')?.textContent?.includes('Retrying')`,
        5000
      );

      // Wait for detail panel to close (retry triggered)
      await libraryPage.waitForFunction(
        `!document.getElementById('detailPanel')?.classList.contains('active')`,
        10000
      );

      console.log('  ✓ Retry button triggered bookmark retry');

      await libraryPage.close();
    });

    await runner.runTest('Retry button hidden for non-error status bookmarks', async () => {
      const libraryPage = await adapter.newPage();
      await libraryPage.goto(adapter.getPageUrl('library'));
      await libraryPage.waitForSelector('#bookmarkList');

      // Find and click a complete/non-error bookmark
      await libraryPage.waitForFunction(
        `(() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const statusDot = card.querySelector('.status-dot');
            if (statusDot && statusDot.classList.contains('status-dot--success')) {
              return true;
            }
          }
          return false;
        })()`,
        30000
      );

      await libraryPage.evaluate(`
        (() => {
          const cards = document.querySelectorAll('.bookmark-card');
          for (const card of cards) {
            const statusDot = card.querySelector('.status-dot');
            if (statusDot && statusDot.classList.contains('status-dot--success')) {
              card.click();
              return;
            }
          }
        })()
      `);

      // Wait for detail panel to open
      await libraryPage.waitForFunction(
        `document.getElementById('detailPanel')?.classList.contains('active')`,
        10000
      );

      // Verify retry button is hidden
      const retryBtnHidden = await libraryPage.evaluate(`
        (() => {
          const retryBtn = document.getElementById('retryBtn');
          return retryBtn && retryBtn.style.display === 'none';
        })()
      `) as boolean;

      if (!retryBtnHidden) {
        throw new Error('Retry button should be hidden for non-error bookmarks');
      }

      console.log('  ✓ Retry button hidden for complete status bookmark');

      await libraryPage.close();
    });
  }
}
