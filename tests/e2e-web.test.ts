import { WebAdapter } from './adapters/web-adapter';
import { PageHandle, TestAdapter } from './e2e-shared';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(PROJECT_ROOT, 'server');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'screenshots', 'web-e2e');

interface ServerProcess {
  process: ChildProcess;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

async function pause(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(page: PageHandle, counter: { n: number }, name: string, fullPage = false): Promise<void> {
  counter.n++;
  const filename = `${String(counter.n).padStart(3, '0')}-${name}.png`;
  await page.screenshot(path.join(SCREENSHOTS_DIR, filename), { fullPage });
  console.log(`  [screenshot] ${filename}`);
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await pause(500);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function killProcessOnPort(port: number): void {
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null`, { stdio: 'ignore' });
  } catch {}
}

async function startDenoServer(mockOpenAIUrl: string): Promise<ServerProcess> {
  const port = 3458; // Different port from walkthrough tests to avoid conflicts
  const url = `http://127.0.0.1:${port}`;
  killProcessOnPort(port);

  const dataDir = path.join(SERVER_DIR, 'data-test-web-e2e');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    CORS_ORIGIN: '*',
    DATABASE_PATH: path.join(dataDir, 'test.db'),
    OPENAI_API_KEY: 'test-key-for-mock',
    OPENAI_API_BASE: mockOpenAIUrl,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    CHAT_MODEL: 'gpt-4o-mini',
  };

  const serverProcess = spawn(
    'deno',
    [
      'run',
      '--allow-net',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-ffi',
      '--unstable-ffi',
      'src/main.ts',
    ],
    {
      cwd: SERVER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const spawnError = new Promise<never>((_, reject) => {
    serverProcess.on('error', (err) => reject(err));
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Deno] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Deno Error] ${data.toString().trim()}`);
  });

  console.log(`Waiting for Deno server at ${url}...`);
  await Promise.race([waitForServer(url), spawnError]);
  console.log(`Deno server ready at ${url}`);

  return {
    process: serverProcess,
    url,
    port,
    stop: async () => {
      return new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          serverProcess.kill('SIGKILL');
          resolve();
        }, 5000);
        serverProcess.on('close', () => {
          clearTimeout(killTimeout);
          resolve();
        });
        serverProcess.kill('SIGTERM');
      });
    },
  };
}

// ========================================
// Scene Functions
// ========================================

async function scene01_connect(
  page: PageHandle,
  adapter: TestAdapter,
  syncServerUrl: string,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 1: Connect Page\n');

  await page.goto(adapter.getPageUrl('index'));
  await page.waitForSelector('#serverUrlInput', 10000);
  await pause(500);
  await capture(page, counter, 'connect-initial');

  // Enter the sync server URL
  await page.type('#serverUrlInput', syncServerUrl);
  await pause(300);
  await capture(page, counter, 'connect-url-entered');

  // Generate a token
  await page.click('#generateBtn');
  await pause(300);
  await capture(page, counter, 'connect-token-generated');

  // Verify token was populated
  await page.waitForFunction(
    `document.getElementById('tokenInput')?.value?.length > 0`,
    5000
  );

  // Click Connect
  await page.click('#connectBtn');
  await pause(500);
  await capture(page, counter, 'connect-connecting');

  // Wait for redirect to library page
  await page.waitForFunction(
    `window.location.href.includes('library.html')`,
    15000
  );
  await pause(1000);
  await capture(page, counter, 'connect-redirected-to-library');

  console.log('  Connect flow completed successfully');
}

async function scene02_libraryAddUrl(
  page: PageHandle,
  adapter: TestAdapter,
  mockServerUrl: string,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 2: Library + Add URL\n');

  await page.goto(adapter.getPageUrl('library'));
  await page.waitForSelector('#bookmarkList', 10000);
  await pause(1000);

  // Verify addUrlSection is visible (web-only feature)
  await page.waitForFunction(
    `!document.getElementById('addUrlSection')?.classList.contains('hidden')`,
    10000
  );
  await capture(page, counter, 'library-add-url-visible');

  // Enter a mock page URL
  const mockPageUrl = `${mockServerUrl}/page/cyberspace-independence`;
  await page.type('#addUrlInput', mockPageUrl);
  await pause(300);
  await capture(page, counter, 'library-url-entered');

  // Click Add
  await page.click('#addUrlBtn');

  // Wait for the bookmark to appear (the button text changes to "Adding..." then back)
  await page.waitForFunction(
    `(() => {
      const btn = document.getElementById('addUrlBtn');
      return btn && btn.textContent === 'Add' && !btn.disabled;
    })()`,
    30000
  );
  await pause(1000);
  await capture(page, counter, 'library-bookmark-added');

  // Refresh and verify bookmark card appears
  await page.goto(adapter.getPageUrl('library'));
  await page.waitForSelector('#bookmarkList', 10000);
  await page.waitForFunction(
    `document.querySelectorAll('.bookmark-card').length > 0`,
    30000
  );
  await pause(500);
  await capture(page, counter, 'library-bookmark-card-visible');

  console.log('  Add URL completed successfully');
}

async function scene03_search(
  page: PageHandle,
  adapter: TestAdapter,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 3: Search\n');

  await page.goto(adapter.getPageUrl('search'));
  await page.waitForSelector('#searchInput', 10000);
  await pause(500);
  await capture(page, counter, 'search-empty');

  // Type a search query
  await page.type('#searchInput', 'cyberspace');
  await pause(300);

  const hasSearchBtn = await page.$('#searchBtn');
  if (hasSearchBtn) {
    await page.click('#searchBtn');
  }

  // Wait for results or status text (both valid since processing is async)
  await page.waitForFunction(
    `(() => {
      const resultsList = document.getElementById('resultsList');
      const resultStatus = document.getElementById('resultStatus');
      if (resultsList && resultsList.children.length > 0) return true;
      if (resultStatus && resultStatus.textContent && resultStatus.textContent.trim().length > 0) return true;
      return false;
    })()`,
    30000
  );
  await pause(500);
  await capture(page, counter, 'search-results');

  // Verify no "Not connected" message
  const notConnected = await page.evaluate<boolean>(
    `document.body.textContent.includes('Not connected to server')`
  );
  if (notConnected) {
    throw new Error('Search page shows "Not connected to server" - auth may have failed');
  }

  console.log('  Search completed successfully');
}

async function scene04_stumble(
  page: PageHandle,
  adapter: TestAdapter,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 4: Stumble\n');

  await page.goto(adapter.getPageUrl('stumble'));
  await page.waitForSelector('#shuffleBtn', 10000);
  await pause(500);
  await capture(page, counter, 'stumble-loaded');

  console.log('  Stumble page loaded successfully');
}

async function scene05_status(
  page: PageHandle,
  adapter: TestAdapter,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 5: Status Dashboard\n');

  await page.goto(adapter.getPageUrl('status'));
  await page.waitForSelector('#statsGrid', 10000);
  await pause(500);

  await page.waitForFunction(
    `document.querySelectorAll('.stat-card').length >= 5`,
    10000
  );
  await capture(page, counter, 'status-dashboard-loaded');

  console.log('  Status page loaded successfully');
}

async function scene06_detailAndDelete(
  page: PageHandle,
  adapter: TestAdapter,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 6: Detail Panel + Delete\n');

  await page.goto(adapter.getPageUrl('library'));
  await page.waitForSelector('#bookmarkList', 10000);
  await page.waitForFunction(
    `document.querySelectorAll('.bookmark-card').length > 0`,
    30000
  );
  await pause(500);
  await capture(page, counter, 'detail-library-loaded');

  // Click the first bookmark card — navigates to view page
  await page.evaluate(`document.querySelector('.bookmark-card').click()`);

  // Wait for view page to load
  await page.waitForSelector('#viewContent', 10000);
  await page.waitForFunction(
    `!document.getElementById('viewContent')?.classList.contains('hidden')`,
    10000
  );
  await pause(500);
  await capture(page, counter, 'view-page-open');

  // Override confirm dialog
  await page.evaluate(`window.confirm = () => true`);

  // Click delete
  await page.evaluate(`
    (() => {
      const btn = document.getElementById('deleteBtn');
      if (btn) {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        btn.click();
      }
    })()
  `);

  // Delete navigates back to library
  await page.waitForSelector('#bookmarkList', 10000);
  await pause(500);
  await capture(page, counter, 'detail-deleted');

  console.log('  Detail + Delete completed successfully');
}

async function scene07_settings(
  page: PageHandle,
  adapter: TestAdapter,
  counter: { n: number }
): Promise<void> {
  console.log('\nScene 7: Settings\n');

  await page.goto(adapter.getPageUrl('options'));
  await page.waitForSelector('.settings-section', 10000);
  await pause(500);
  await capture(page, counter, 'settings-initial');

  const apiConfigHidden = await page.evaluate<boolean>(
    `(() => {
      const navItem = document.querySelector('.nav-item[data-section="api-config"]');
      return navItem ? navItem.style.display === 'none' : true;
    })()`
  );
  if (!apiConfigHidden) {
    throw new Error('api-config nav item should be hidden in web mode');
  }
  console.log('  api-config nav item correctly hidden');

  await page.click('a[data-section="server-sync"]');
  await pause(500);

  // Wait for loadSettings to complete and reveal the correct section
  await page.waitForFunction(
    `(() => {
      const connected = document.getElementById('serverConnectedSection');
      return connected && !connected.classList.contains('hidden');
    })()`,
    5000
  );
  await capture(page, counter, 'settings-server-sync');

  const syncFieldsExist = await page.$('#serverSyncFields');
  if (!syncFieldsExist) {
    throw new Error('Server sync fields not found');
  }
  console.log('  Server sync section visible');

  // When connected, only the connected section should be visible, not the setup section
  const setupHidden = await page.evaluate<boolean>(
    `document.getElementById('serverSetupSection')?.classList.contains('hidden') ?? false`
  );
  if (!setupHidden) {
    throw new Error('Setup section should be hidden when connected');
  }
  const connectedVisible = await page.evaluate<boolean>(
    `!document.getElementById('serverConnectedSection')?.classList.contains('hidden')`
  );
  if (!connectedVisible) {
    throw new Error('Connected section should be visible when connected');
  }
  console.log('  Connected state: only connected section visible (setup hidden)');

  await page.click('a[data-section="bulk-import"]');
  await pause(500);
  await capture(page, counter, 'settings-bulk-import');

  const bulkImportExists = await page.$('#bulkUrlsInput');
  if (!bulkImportExists) {
    throw new Error('Bulk import section not found');
  }
  console.log('  Bulk import section visible');

  console.log('  Settings verification completed successfully');
}

// ========================================
// Main Execution
// ========================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('E2E Web App Test');
  console.log('='.repeat(60));
  console.log(`Browser: ${process.env.BROWSER_PATH || '(not set)'}`);
  console.log(`Output: ${SCREENSHOTS_DIR}`);
  console.log('='.repeat(60));

  // Clean screenshots directory
  if (fs.existsSync(SCREENSHOTS_DIR)) {
    fs.rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  let adapter: WebAdapter | null = null;
  let denoServer: ServerProcess | null = null;
  let page: PageHandle | null = null;
  const counter = { n: 0 };

  try {
    // Create and setup web adapter (starts its own mock OpenAI server + static file server)
    adapter = new WebAdapter();
    await adapter.setup();

    const mockApiUrl = adapter.getMockApiUrl();
    console.log(`Mock OpenAI server: ${mockApiUrl}`);

    // Start Deno sync server using the adapter's mock OpenAI URL
    denoServer = await startDenoServer(mockApiUrl);
    console.log(`Deno sync server: ${denoServer.url}`);

    // Create page
    page = await adapter.newPage();

    // Run scenes
    await scene01_connect(page, adapter, denoServer.url, counter);
    await scene02_libraryAddUrl(page, adapter, mockApiUrl, counter);
    await scene03_search(page, adapter, counter);
    await scene04_stumble(page, adapter, counter);
    await scene05_status(page, adapter, counter);
    await scene06_detailAndDelete(page, adapter, counter);
    await scene07_settings(page, adapter, counter);

    console.log('\n' + '='.repeat(60));
    console.log(`Web E2E test PASSED: ${counter.n} screenshots captured`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('Web E2E test FAILED:', error);
    console.error('='.repeat(60));

    // Take a failure screenshot if page is available
    if (page) {
      try {
        await capture(page, counter, 'FAILURE');
      } catch {}
    }

    process.exit(1);
  } finally {
    if (page) {
      await page.close();
    }
    if (denoServer) {
      console.log('Stopping Deno server...');
      await denoServer.stop();
    }
    if (adapter) {
      await adapter.teardown();
    }

    // Clean up test data
    const dataDir = path.join(SERVER_DIR, 'data-test-web-e2e');
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

main();
