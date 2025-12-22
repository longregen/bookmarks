/**
 * E2E Tests for WebDAV Sync Functionality
 *
 * Tests the WebDAV sync feature in the options page, including:
 * - Toggle enable/disable and field visibility
 * - Entering and persisting WebDAV credentials
 * - Connection testing with mocked WebDAV server
 * - URL validation and security warnings (HTTP vs HTTPS)
 * - Sync status indicator and sync now button
 * - Form validation and error handling
 *
 * Usage:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npm run test:e2e:webdav
 *
 * Or directly:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npx tsx tests/e2e-options-webdav.test.ts
 *
 * Note: Uses mocked WebDAV server for testing (credentials: testuser/testpass)
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, PageHandle, waitForSettingsLoad } from './e2e-shared';

async function runWebDAVTests(adapter: ChromeAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- WebDAV Sync E2E Tests ---\n');

  await runner.runTest('WebDAV section loads with toggle disabled by default', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Check toggle exists and is unchecked by default
    const isChecked = await page.evaluate(`document.getElementById('webdavEnabled').checked`);
    if (isChecked) {
      throw new Error('WebDAV toggle should be unchecked by default');
    }

    // Verify fields are hidden when toggle is off
    const fieldsHidden = await page.evaluate(`
      document.getElementById('webdavFields').classList.contains('hidden')
    `);
    if (!fieldsHidden) {
      throw new Error('WebDAV fields should be hidden when toggle is off');
    }

    await page.close();
  });

  await runner.runTest('Enabling WebDAV toggle shows configuration fields', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable the toggle
    await page.click('#webdavEnabled');

    // Wait for fields to become visible
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Verify all required fields are present
    const hasUrl = await page.$('#webdavUrl');
    const hasUsername = await page.$('#webdavUsername');
    const hasPassword = await page.$('#webdavPassword');
    const hasPath = await page.$('#webdavPath');
    const hasInterval = await page.$('#webdavSyncInterval');
    const hasTestBtn = await page.$('#testWebdavBtn');
    const hasSyncBtn = await page.$('#syncNowBtn');

    if (!hasUrl || !hasUsername || !hasPassword || !hasPath || !hasInterval || !hasTestBtn || !hasSyncBtn) {
      throw new Error('Not all WebDAV configuration fields are present');
    }

    await page.close();
  });

  await runner.runTest('Disabling WebDAV toggle hides configuration fields', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable the toggle
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Disable the toggle
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    const fieldsHidden = await page.evaluate(`
      document.getElementById('webdavFields').classList.contains('hidden')
    `);
    if (!fieldsHidden) {
      throw new Error('WebDAV fields should be hidden when toggle is off');
    }

    await page.close();
  });

  await runner.runTest('Entering WebDAV credentials and saving settings', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Fill in credentials
    await page.evaluate(`
      document.getElementById('webdavUrl').value = 'https://cloud.example.com/remote.php/dav/files/testuser';
      document.getElementById('webdavUsername').value = 'testuser';
      document.getElementById('webdavPassword').value = 'testpassword123';
      document.getElementById('webdavPath').value = '/bookmarks';
      document.getElementById('webdavSyncInterval').value = '30';
    `);

    // Submit the form
    const submitBtn = await page.$('#webdavForm [type="submit"]');
    if (!submitBtn) {
      throw new Error('WebDAV form submit button not found');
    }

    await page.click('#webdavForm [type="submit"]');

    // Wait for success message
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('status');
        return status && status.textContent && status.textContent.includes('success');
      })()`,
      10000
    );

    await page.close();
  });

  await runner.runTest('WebDAV settings persist after page reload', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV and set values
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    await page.evaluate(`
      document.getElementById('webdavUrl').value = 'https://cloud.example.com/remote.php/dav/files/persisttest';
      document.getElementById('webdavUsername').value = 'persistuser';
      document.getElementById('webdavPassword').value = 'persist123';
      document.getElementById('webdavPath').value = '/persist-bookmarks';
      document.getElementById('webdavSyncInterval').value = '60';
    `);

    // Save settings
    await page.click('#webdavForm [type="submit"]');
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('status');
        return status && status.textContent && status.textContent.includes('success');
      })()`,
      10000
    );

    // Reload the page
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Verify settings persisted
    const settings = await page.evaluate(`({
      enabled: document.getElementById('webdavEnabled').checked,
      url: document.getElementById('webdavUrl').value,
      username: document.getElementById('webdavUsername').value,
      password: document.getElementById('webdavPassword').value,
      path: document.getElementById('webdavPath').value,
      interval: document.getElementById('webdavSyncInterval').value
    })`);

    if (!settings.enabled) {
      throw new Error('WebDAV enabled state did not persist');
    }
    if (settings.url !== 'https://cloud.example.com/remote.php/dav/files/persisttest') {
      throw new Error(`WebDAV URL did not persist: ${settings.url}`);
    }
    if (settings.username !== 'persistuser') {
      throw new Error(`WebDAV username did not persist: ${settings.username}`);
    }
    if (settings.password !== 'persist123') {
      throw new Error(`WebDAV password did not persist: ${settings.password}`);
    }
    if (settings.path !== '/persist-bookmarks') {
      throw new Error(`WebDAV path did not persist: ${settings.path}`);
    }
    if (settings.interval !== '60') {
      throw new Error(`WebDAV interval did not persist: ${settings.interval}`);
    }

    await page.close();
  });

  await runner.runTest('HTTP URL shows security warning', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Enter HTTP URL (insecure)
    await page.evaluate(`
      const urlInput = document.getElementById('webdavUrl');
      urlInput.value = 'http://insecure.example.com/dav';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    `);

    // Wait for warning to appear
    await new Promise(resolve => setTimeout(resolve, 300));

    const warningVisible = await page.evaluate(`
      !document.getElementById('webdavUrlWarning').classList.contains('hidden')
    `);

    if (!warningVisible) {
      throw new Error('Security warning should be visible for HTTP URL');
    }

    await page.close();
  });

  await runner.runTest('HTTPS URL hides security warning', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Enter HTTPS URL (secure)
    await page.evaluate(`
      const urlInput = document.getElementById('webdavUrl');
      urlInput.value = 'https://secure.example.com/dav';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    `);

    // Wait for validation
    await new Promise(resolve => setTimeout(resolve, 300));

    const warningHidden = await page.evaluate(`
      document.getElementById('webdavUrlWarning').classList.contains('hidden')
    `);

    if (!warningHidden) {
      throw new Error('Security warning should be hidden for HTTPS URL');
    }

    await page.close();
  });

  await runner.runTest('Test connection button requires URL, username, and password', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Try to test connection without filling in credentials
    await page.click('#testWebdavBtn');

    // Wait for error status
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('webdavConnectionStatus');
        return status && status.classList.contains('error');
      })()`,
      5000
    );

    const statusText = await page.evaluate(`
      document.querySelector('#webdavConnectionStatus .status-text').textContent
    `);

    if (!statusText.includes('fill in')) {
      throw new Error(`Expected error message about missing fields, got: ${statusText}`);
    }

    await page.close();
  });

  await runner.runTest('Test connection button shows testing state during request', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV and fill credentials
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Intercept fetch to delay response for testing UI state
    await page.evaluate(`
      window.originalFetch = window.fetch;
      window.fetch = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return window.originalFetch(...args);
      };
    `);

    await page.evaluate(`
      document.getElementById('webdavUrl').value = 'https://cloud.example.com/dav';
      document.getElementById('webdavUsername').value = 'testuser';
      document.getElementById('webdavPassword').value = 'testpass';
    `);

    // Click test button
    await page.click('#testWebdavBtn');

    // Immediately check for testing state
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('webdavConnectionStatus');
        return status && status.classList.contains('testing');
      })()`,
      2000
    );

    const testingText = await page.evaluate(`
      document.querySelector('#webdavConnectionStatus .status-text').textContent
    `);

    if (!testingText.includes('Testing')) {
      throw new Error(`Expected "Testing" message, got: ${testingText}`);
    }

    await page.close();
  });

  await runner.runTest('Test connection with mock WebDAV server - successful connection', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Use mock server URL with valid credentials
    const mockServerUrl = adapter.getMockApiUrl();
    await page.evaluate(`
      document.getElementById('webdavUrl').value = '${mockServerUrl}/webdav/test';
      document.getElementById('webdavUsername').value = 'testuser';
      document.getElementById('webdavPassword').value = 'testpass';
    `);

    // Click test button
    await page.click('#testWebdavBtn');

    // Wait for success status
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('webdavConnectionStatus');
        return status && status.classList.contains('success');
      })()`,
      10000
    );

    const statusText = await page.evaluate(`
      document.querySelector('#webdavConnectionStatus .status-text').textContent
    `);

    if (!statusText.toLowerCase().includes('success')) {
      throw new Error(`Expected success message, got: ${statusText}`);
    }

    await page.close();
  });

  await runner.runTest('Test connection with mock WebDAV server - authentication failure', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Use mock server URL with invalid credentials
    const mockServerUrl = adapter.getMockApiUrl();
    await page.evaluate(`
      document.getElementById('webdavUrl').value = '${mockServerUrl}/webdav/test';
      document.getElementById('webdavUsername').value = 'wronguser';
      document.getElementById('webdavPassword').value = 'wrongpass';
    `);

    // Click test button
    await page.click('#testWebdavBtn');

    // Wait for error status
    await page.waitForFunction(
      `(() => {
        const status = document.getElementById('webdavConnectionStatus');
        return status && status.classList.contains('error');
      })()`,
      10000
    );

    const statusText = await page.evaluate(`
      document.querySelector('#webdavConnectionStatus .status-text').textContent
    `);

    if (!statusText.toLowerCase().includes('authentication') && !statusText.toLowerCase().includes('401')) {
      throw new Error(`Expected authentication error message, got: ${statusText}`);
    }

    await page.close();
  });

  await runner.runTest('Sync now button is present when WebDAV is enabled', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Check sync now button exists
    const hasSyncBtn = await page.$('#syncNowBtn');
    if (!hasSyncBtn) {
      throw new Error('Sync now button should be present when WebDAV is enabled');
    }

    const btnText = await page.evaluate(`
      document.getElementById('syncNowBtn').textContent.trim()
    `);

    if (!btnText.includes('Sync')) {
      throw new Error(`Expected "Sync" in button text, got: ${btnText}`);
    }

    await page.close();
  });

  await runner.runTest('Sync status indicator is present and shows initial state', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Check sync status indicator exists
    const hasStatusIndicator = await page.$('#syncStatusIndicator');
    if (!hasStatusIndicator) {
      throw new Error('Sync status indicator should be present');
    }

    const statusText = await page.evaluate(`
      document.querySelector('#syncStatusIndicator .sync-status-text').textContent
    `);

    // Initial state should show "Not synced yet" or last sync time
    if (!statusText) {
      throw new Error('Sync status text should not be empty');
    }

    await page.close();
  });

  await runner.runTest('Form validation: sync interval accepts valid numbers', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Test various valid intervals
    const validIntervals = ['0', '15', '30', '60', '1440'];

    for (const interval of validIntervals) {
      await page.evaluate(`
        document.getElementById('webdavSyncInterval').value = '${interval}';
      `);

      const value = await page.evaluate(`
        document.getElementById('webdavSyncInterval').value
      `);

      if (value !== interval) {
        throw new Error(`Interval ${interval} should be accepted, got: ${value}`);
      }
    }

    await page.close();
  });

  await runner.runTest('Allow insecure checkbox toggles correctly', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Check initial state (should be unchecked)
    const initialState = await page.evaluate(`
      document.getElementById('webdavAllowInsecure').checked
    `);

    if (initialState) {
      throw new Error('Allow insecure checkbox should be unchecked by default');
    }

    // Toggle checkbox
    await page.click('#webdavAllowInsecure');

    const afterToggle = await page.evaluate(`
      document.getElementById('webdavAllowInsecure').checked
    `);

    if (!afterToggle) {
      throw new Error('Allow insecure checkbox should be checked after click');
    }

    await page.close();
  });

  await runner.runTest('Empty URL clears security warning', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    // Enter HTTP URL to trigger warning
    await page.evaluate(`
      const urlInput = document.getElementById('webdavUrl');
      urlInput.value = 'http://insecure.example.com/dav';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Clear the URL
    await page.evaluate(`
      const urlInput = document.getElementById('webdavUrl');
      urlInput.value = '';
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    `);

    await new Promise(resolve => setTimeout(resolve, 300));

    const warningHidden = await page.evaluate(`
      document.getElementById('webdavUrlWarning').classList.contains('hidden')
    `);

    if (!warningHidden) {
      throw new Error('Security warning should be hidden when URL is empty');
    }

    await page.close();
  });

  await runner.runTest('WebDAV form has proper submit button', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('options'));
    await page.waitForSelector('#webdavEnabled');
    await waitForSettingsLoad(page);

    // Enable WebDAV
    await page.click('#webdavEnabled');
    await page.waitForFunction(
      `!document.getElementById('webdavFields').classList.contains('hidden')`,
      5000
    );

    const submitBtn = await page.$('#webdavForm [type="submit"]');
    if (!submitBtn) {
      throw new Error('WebDAV form submit button not found');
    }

    const btnText = await page.evaluate(`
      document.querySelector('#webdavForm [type="submit"]').textContent.trim()
    `);

    if (!btnText.includes('Save')) {
      throw new Error(`Expected "Save" in submit button text, got: ${btnText}`);
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('WebDAV E2E Tests (Chrome Extension)');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    await runWebDAVTests(adapter, runner);

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

  console.log('\n✓ All WebDAV E2E tests passed!');
}

main();
