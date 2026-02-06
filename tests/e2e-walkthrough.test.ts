import { ChromeAdapter } from './adapters/chrome-adapter';
import { FirefoxAdapter } from './adapters/firefox-adapter';
import { PageHandle, TestAdapter, waitForSettingsLoad } from './e2e-shared';
import { startMockServer, getMockPageUrls, MockServer } from './mock-server';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(PROJECT_ROOT, 'server');
const SCREENSHOTS_BASE = path.join(PROJECT_ROOT, 'screenshots', 'walkthrough');

// Themes to showcase
const THEMES = ['light', 'dark', 'terminal', 'tufte'] as const;
type Theme = (typeof THEMES)[number];

type BrowserType = 'chrome' | 'firefox';
type ServerType = 'deno' | 'wrangler';

interface ServerProcess {
  type: ServerType;
  process: ChildProcess;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

interface WalkthroughContext {
  adapter: TestAdapter;
  page: PageHandle;
  mockServerUrl: string;
  syncServerUrl: string | null;
  screenshotsDir: string;
  screenshotCounter: number;
  browserType: BrowserType;
  serverType: ServerType | null;
}

async function capture(ctx: WalkthroughContext, name: string, fullPage = false): Promise<void> {
  ctx.screenshotCounter++;
  const filename = `${String(ctx.screenshotCounter).padStart(3, '0')}-${name}.png`;
  await ctx.page.screenshot(path.join(ctx.screenshotsDir, filename), { fullPage });
  console.log(`  📸 ${filename}`);
}

async function pause(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function setTheme(page: PageHandle, theme: Theme | 'auto'): Promise<void> {
  if (theme === 'auto') {
    await page.evaluate(`document.documentElement.removeAttribute('data-theme')`);
  } else {
    await page.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
  }
  await pause(300);
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
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
  const port = 3456;
  const url = `http://127.0.0.1:${port}`;
  killProcessOnPort(port);

  const dataDir = path.join(SERVER_DIR, 'data-test-deno');
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

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Deno] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Deno Error] ${data.toString().trim()}`);
  });

  console.log(`Waiting for Deno server at ${url}...`);
  await Promise.race([waitForServer(url), spawnError]);
  console.log(`Deno server ready at ${url}`);

  return {
    type: 'deno',
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

async function startWranglerServer(mockOpenAIUrl: string): Promise<ServerProcess> {
  const port = 3457;
  const url = `http://127.0.0.1:${port}`;
  killProcessOnPort(port);

  const dataDir = path.join(SERVER_DIR, '.wrangler-test');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENAI_API_KEY: 'test-key-for-mock',
    OPENAI_API_BASE: mockOpenAIUrl,
    CORS_ORIGIN: '*',
  };

  const serverProcess = spawn(
    'wrangler',
    [
      'dev',
      '--local',
      '--port',
      String(port),
      '--persist-to',
      dataDir,
      '--env',
      'dev',
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

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Wrangler] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    // Filter out noisy wrangler output
    if (!msg.includes('⎔') && !msg.includes('│') && msg.length > 0) {
      console.error(`[Wrangler] ${msg}`);
    }
  });

  console.log(`Waiting for Wrangler server at ${url}...`);
  await Promise.race([waitForServer(url, 60000), spawnError]); // Wrangler can take longer to start
  console.log(`Wrangler server ready at ${url}`);

  return {
    type: 'wrangler',
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

async function scene01_welcome(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 1: Welcome & Onboarding\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('options'));
  await ctx.page.waitForSelector('.settings-section', 10000);
  await pause(500);
  await capture(ctx, 'welcome-settings-initial');

  await pause(300);
  await capture(ctx, 'settings-appearance-section');

  await ctx.page.click('a[data-section="api-config"]');
  await pause(500);
  await capture(ctx, 'settings-api-section-empty');

  await ctx.page.click('a[data-section="about"]');
  await pause(500);
  await capture(ctx, 'settings-about-section', true);
}

async function scene02_apiConfig(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 2: API Configuration\n');

  await ctx.page.click('a[data-section="api-config"]');
  await ctx.page.waitForSelector('#apiBaseUrl');
  await waitForSettingsLoad(ctx.page);
  await pause(300);
  await capture(ctx, 'api-config-empty');

  await ctx.page.evaluate(`document.getElementById('apiBaseUrl').value = '${ctx.mockServerUrl}'`);
  await pause(200);
  await capture(ctx, 'api-config-baseurl-filled');

  await ctx.page.evaluate(`document.getElementById('apiKey').value = 'mock-api-key'`);
  await pause(200);
  await capture(ctx, 'api-config-apikey-filled');

  await ctx.page.evaluate(`document.getElementById('chatModel').value = 'gpt-4o-mini'`);
  await ctx.page.evaluate(`document.getElementById('embeddingModel').value = 'text-embedding-3-small'`);
  await pause(200);
  await capture(ctx, 'api-config-models-filled');

  await ctx.page.click('[type="submit"]');
  await ctx.page.waitForFunction(
    `document.querySelector('.status')?.textContent?.includes('success')`,
    10000
  );
  await capture(ctx, 'api-config-saved-success');

  await ctx.page.click('#testBtn');
  await pause(500);
  await capture(ctx, 'api-config-testing');

  await ctx.page.waitForFunction(
    `(() => {
      const status = document.querySelector('#testConnectionStatus');
      return status && !status.classList.contains('hidden') &&
             (status.textContent?.includes('successful') || status.textContent?.includes('failed'));
    })()`,
    30000
  );
  await capture(ctx, 'api-config-test-result');
}

async function scene03_popupFlow(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 3: First Bookmark - Popup Flow\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('popup'));
  await ctx.page.waitForSelector('#saveBtn');
  await pause(500);
  await capture(ctx, 'popup-initial');

  // Only Chrome extension supports runtime messaging
  if (ctx.browserType === 'chrome') {
    const testUrl = `${ctx.mockServerUrl}/page/cyberspace-independence`;
    await ctx.page.evaluate(`
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'bookmark:save_from_page',
            data: {
              url: '${testUrl}',
              title: 'A Declaration of the Independence of Cyberspace',
              html: '<html><body><h1>Declaration of Cyberspace</h1><p>Test content</p></body></html>'
            }
          },
          (response) => resolve(response)
        );
      })
    `);
    await pause(1000);
    await capture(ctx, 'popup-bookmark-saved');
  }

  await ctx.page.goto(ctx.adapter.getPageUrl('library'));
  await ctx.page.waitForSelector('#bookmarkList');
  await pause(500);
  await capture(ctx, 'library-after-popup');
}

async function scene04_bulkImport(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 4: Bulk Import\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('options'));
  await ctx.page.waitForSelector('.settings-section');
  await ctx.page.click('a[data-section="bulk-import"]');
  await ctx.page.waitForSelector('#bulkUrlsInput');
  await pause(300);
  await capture(ctx, 'bulk-import-empty');

  const mockUrls = getMockPageUrls(ctx.mockServerUrl);
  const urlsText = mockUrls.join('\\n');

  await ctx.page.evaluate(`(() => {
    const el = document.getElementById('bulkUrlsInput');
    el.value = '${urlsText}';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await pause(800);
  await capture(ctx, 'bulk-import-urls-entered');

  await ctx.page.waitForFunction(
    `(() => {
      const feedback = document.getElementById('urlValidationFeedback');
      const btn = document.getElementById('startBulkImport');
      return feedback?.textContent?.includes('valid') && btn && !btn.disabled;
    })()`,
    10000
  );
  await capture(ctx, 'bulk-import-validated');

  await ctx.page.click('#startBulkImport');
  await pause(500);
  await capture(ctx, 'bulk-import-started');

  await ctx.page.waitForFunction(
    `document.getElementById('bulkImportProgress') && !document.getElementById('bulkImportProgress').classList.contains('hidden')`,
    5000
  );
  await capture(ctx, 'bulk-import-processing');

  await ctx.page.waitForFunction(
    `(() => {
      const statusDiv = document.querySelector('.status');
      if (statusDiv && statusDiv.textContent) {
        const text = statusDiv.textContent.toLowerCase();
        if (text.includes('bulk import completed')) return true;
      }
      const status = document.getElementById('bulkImportStatus');
      if (status && status.textContent) {
        const text = status.textContent;
        if (text.includes('Completed 3 of 3')) return true;
      }
      return false;
    })()`,
    90000
  );
  await capture(ctx, 'bulk-import-completed');
}

async function scene05_libraryOverview(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 5: Library Overview\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('library'));
  await ctx.page.waitForSelector('#bookmarkList');
  await ctx.page.waitForFunction(`document.querySelectorAll('.bookmark-card').length >= 3`, 30000);
  await pause(500);
  await capture(ctx, 'library-all-bookmarks');

  await ctx.page.evaluate(`
    (() => {
      const card = document.querySelector('.bookmark-card');
      if (card) {
        card.classList.add('hover');
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }
    })()
  `);
  await pause(300);
  await capture(ctx, 'library-card-hover');

  await ctx.page.evaluate(`
    (() => {
      const card = document.querySelector('.bookmark-card');
      if (card) {
        card.classList.remove('hover');
        card.style.boxShadow = '';
      }
    })()
  `);

  const hasSortDropdown = await ctx.page.$('#sortSelect');
  if (hasSortDropdown) {
    await ctx.page.select('#sortSelect', 'title');
    await pause(500);
    await capture(ctx, 'library-sorted-title-asc');

    await ctx.page.select('#sortSelect', 'newest');
    await pause(500);
    await capture(ctx, 'library-sorted-newest');
  }
}

async function scene06_detailPanel(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 6: Detail Panel\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('library'));
  await ctx.page.waitForSelector('#bookmarkList');
  await ctx.page.waitForFunction(`document.querySelectorAll('.bookmark-card').length > 0`, 30000);
  await pause(300);

  await ctx.page.evaluate(`document.querySelector('.bookmark-card').click()`);

  await ctx.page.waitForFunction(
    `document.getElementById('detailPanel')?.classList.contains('active')`,
    10000
  );
  await pause(500);
  await capture(ctx, 'detail-panel-open');
  await capture(ctx, 'detail-panel-content', true);

  const hasExportBtn = await ctx.page.$('#exportBtn');
  if (hasExportBtn) {
    await ctx.page.evaluate(`
      (() => {
        const btn = document.getElementById('exportBtn');
        if (btn) {
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          btn.click();
        }
      })()
    `);
    await pause(500);

    const hasExportMenu = await ctx.page.$('.export-format-menu');
    if (hasExportMenu) {
      await capture(ctx, 'detail-panel-export-menu');
      await ctx.page.evaluate(`
        (() => {
          const menu = document.querySelector('.export-format-menu');
          if (menu) menu.remove();
        })()
      `);
    }
  }

  await ctx.page.evaluate(`
    (() => {
      const backdrop = document.getElementById('detailBackdrop');
      if (backdrop) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()
  `);
  await ctx.page.waitForFunction(
    `!document.getElementById('detailPanel')?.classList.contains('active')`,
    10000
  );
  await pause(300);
  await capture(ctx, 'detail-panel-closed');
}

async function scene07_search(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 7: Search\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('search'));
  await ctx.page.waitForSelector('#searchInput');
  await pause(500);
  await capture(ctx, 'search-empty');

  await ctx.page.type('#searchInput', 'cyberspace');
  await pause(300);
  await capture(ctx, 'search-typing');

  const hasSearchBtn = await ctx.page.$('#searchBtn');
  if (hasSearchBtn) {
    await ctx.page.click('#searchBtn');
  }

  await ctx.page.waitForFunction(
    `(() => {
      const resultsList = document.getElementById('resultsList');
      const resultStatus = document.getElementById('resultStatus');
      return (resultsList && resultsList.children.length > 0) ||
             (resultStatus && resultStatus.textContent?.includes('result'));
    })()`,
    30000
  );
  await pause(500);
  await capture(ctx, 'search-results');
}

async function scene08_stumble(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 8: Stumble / Random Discovery\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('stumble'));
  await ctx.page.waitForSelector('#shuffleBtn');
  await pause(500);

  await ctx.page.waitForFunction(
    `(() => {
      const stumbleList = document.getElementById('stumbleList');
      return stumbleList && stumbleList.children.length > 0;
    })()`,
    30000
  );
  await capture(ctx, 'stumble-initial');

  await ctx.page.click('#shuffleBtn');
  await pause(800);
  await capture(ctx, 'stumble-shuffled');
}

async function scene09_jobs(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 9: Jobs Dashboard\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('jobs'));
  await ctx.page.waitForSelector('#jobsList');
  await pause(500);
  await capture(ctx, 'jobs-dashboard-initial');

  await ctx.page.waitForFunction(
    `document.querySelectorAll('.job-item').length > 0 || document.querySelector('#jobsList')?.textContent?.includes('No jobs')`,
    10000
  );
  await capture(ctx, 'jobs-dashboard-loaded');
}

async function scene10_themeShowcase(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 10: Theme Showcase\n');

  for (const theme of THEMES) {
    await ctx.page.goto(ctx.adapter.getPageUrl('options'));
    await ctx.page.waitForSelector('#themeAuto');
    const themeId = `theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
    await ctx.page.click(`label[for="${themeId}"]`);
    await pause(400);

    await ctx.page.goto(ctx.adapter.getPageUrl('library'));
    await ctx.page.waitForSelector('#bookmarkList');
    await pause(500);
    await capture(ctx, `theme-${theme}-library`);
  }

  // Reset to light theme
  await ctx.page.goto(ctx.adapter.getPageUrl('options'));
  await ctx.page.waitForSelector('#themeLight');
  await ctx.page.click('label[for="themeLight"]');
  await pause(300);
}

async function scene11_serverSync(ctx: WalkthroughContext): Promise<void> {
  if (!ctx.syncServerUrl) {
    console.log('\n📽️  Scene 11: Server Sync (SKIPPED - no server)\n');
    return;
  }

  console.log('\n📽️  Scene 11: Server Sync & Token Auth\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('options'));
  await ctx.page.waitForSelector('.settings-section');
  await ctx.page.click('a[data-section="server-sync"]');
  await pause(500);
  await capture(ctx, 'server-sync-disabled');

  await ctx.page.click('#serverEnabled');
  await ctx.page.waitForFunction(
    `!document.getElementById('serverSyncFields')?.classList.contains('hidden')`,
    5000
  );
  await capture(ctx, 'server-sync-enabled');

  await ctx.page.type('#serverUrl', ctx.syncServerUrl);
  await ctx.page.click('#serverSaveUrlBtn');
  await pause(500);
  await capture(ctx, 'server-sync-url-configured');

  try {
    // Generate a token
    await ctx.page.click('#serverGenerateTokenBtn');
    await pause(300);
    await capture(ctx, 'server-sync-token-generated');

    // Connect with the token
    await ctx.page.click('#serverConnectBtn');
    await capture(ctx, 'server-sync-connecting');

    await ctx.page.waitForFunction(
      `(() => {
        const loggedInSection = document.getElementById('serverLoggedInSection');
        return loggedInSection && !loggedInSection.classList.contains('hidden');
      })()`,
      10000
    );
    await capture(ctx, 'server-sync-connected');

    await ctx.page.click('#serverSyncNowBtn');
    await pause(500);
    await capture(ctx, 'server-sync-syncing');

    await ctx.page.waitForFunction(
      `(() => {
        const statusText = document.getElementById('serverSyncStatusText')?.textContent || '';
        return statusText.includes('Last synced') || statusText.includes('Error');
      })()`,
      30000
    );
    await capture(ctx, 'server-sync-completed');
  } catch (error) {
    console.error('  Token auth error:', error);
  }
}

async function scene12_deleteCleanup(ctx: WalkthroughContext): Promise<void> {
  console.log('\n📽️  Scene 12: Delete & Cleanup\n');

  await ctx.page.goto(ctx.adapter.getPageUrl('library'));
  await ctx.page.waitForSelector('#bookmarkList');
  await ctx.page.waitForFunction(`document.querySelectorAll('.bookmark-card').length > 0`, 30000);
  await capture(ctx, 'delete-initial-state');

  await ctx.page.evaluate(`document.querySelector('.bookmark-card').click()`);
  await ctx.page.waitForFunction(
    `document.getElementById('detailPanel')?.classList.contains('active')`,
    10000
  );
  await capture(ctx, 'delete-detail-open');

  await ctx.page.evaluate(`window.confirm = () => true`);

  await ctx.page.evaluate(`
    (() => {
      const btn = document.getElementById('deleteBtn');
      if (btn) {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        btn.click();
      }
    })()
  `);

  await ctx.page.waitForFunction(
    `!document.getElementById('detailPanel')?.classList.contains('active')`,
    10000
  );
  await pause(500);
  await capture(ctx, 'delete-completed');
}

// ========================================
// Walkthrough Runner
// ========================================

async function runWalkthrough(
  browserType: BrowserType,
  serverType: ServerType | null,
  mockServer: MockServer
): Promise<{ success: boolean; error?: string }> {
  const label = `${browserType}-${serverType || 'no-server'}`;
  console.log('\n' + '='.repeat(60));
  console.log(`Starting walkthrough: ${label}`);
  console.log('='.repeat(60));

  const screenshotsDir = path.join(SCREENSHOTS_BASE, label);
  if (fs.existsSync(screenshotsDir)) {
    fs.rmSync(screenshotsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(screenshotsDir, { recursive: true });

  let adapter: TestAdapter | null = null;
  let syncServer: ServerProcess | null = null;
  let page: PageHandle | null = null;

  try {
    // Create browser adapter
    if (browserType === 'chrome') {
      adapter = new ChromeAdapter();
    } else {
      adapter = new FirefoxAdapter();
    }
    await adapter.setup();

    // Start sync server if requested
    if (serverType && fs.existsSync(SERVER_DIR)) {
      try {
        if (serverType === 'deno') {
          syncServer = await startDenoServer(mockServer.url);
        } else {
          syncServer = await startWranglerServer(mockServer.url);
        }
      } catch (error) {
        console.warn(`Could not start ${serverType} server:`, error);
      }
    }

    page = await adapter.newPage();

    const ctx: WalkthroughContext = {
      adapter,
      page,
      mockServerUrl: mockServer.url,
      syncServerUrl: syncServer?.url || null,
      screenshotsDir,
      screenshotCounter: 0,
      browserType,
      serverType,
    };

    // Run all scenes
    await scene01_welcome(ctx);
    await scene02_apiConfig(ctx);
    await scene03_popupFlow(ctx);
    await scene04_bulkImport(ctx);
    await scene05_libraryOverview(ctx);
    await scene06_detailPanel(ctx);
    await scene07_search(ctx);
    await scene08_stumble(ctx);
    await scene09_jobs(ctx);
    await scene10_themeShowcase(ctx);
    await scene11_serverSync(ctx);
    await scene12_deleteCleanup(ctx);

    console.log(`\n✓ Walkthrough ${label} complete: ${ctx.screenshotCounter} screenshots`);
    return { success: true };
  } catch (error) {
    console.error(`\n✗ Walkthrough ${label} failed:`, error);
    return { success: false, error: String(error) };
  } finally {
    if (page) {
      await page.close();
    }
    if (adapter) {
      await adapter.teardown();
    }
    if (syncServer) {
      console.log(`Stopping ${syncServer.type} server...`);
      await syncServer.stop();
    }
  }
}

// ========================================
// Main Execution
// ========================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('E2E Walkthrough Test Matrix');
  console.log('='.repeat(60));
  console.log(`Chrome: ${process.env.BROWSER_PATH || '(not set)'}`);
  console.log(`Firefox: ${process.env.FIREFOX_PATH || process.env.BROWSER_PATH || '(not set)'}`);
  console.log(`Output: ${SCREENSHOTS_BASE}`);
  console.log('='.repeat(60));

  // Determine which combinations to run
  const browsers: BrowserType[] = [];
  const servers: (ServerType | null)[] = [];

  if (!process.env.SKIP_CHROME && process.env.BROWSER_PATH) {
    browsers.push('chrome');
  }
  if (!process.env.SKIP_FIREFOX && (process.env.FIREFOX_PATH || process.env.BROWSER_PATH)) {
    browsers.push('firefox');
  }

  if (!process.env.SKIP_DENO) {
    servers.push('deno');
  }
  if (!process.env.SKIP_WRANGLER) {
    servers.push('wrangler');
  }

  // Always include a no-server run for basic functionality
  servers.push(null);

  if (browsers.length === 0) {
    console.error('No browsers available. Set BROWSER_PATH or FIREFOX_PATH.');
    process.exit(1);
  }

  console.log(`\nMatrix: ${browsers.length} browsers × ${servers.length} server configs`);
  console.log(`  Browsers: ${browsers.join(', ')}`);
  console.log(`  Servers: ${servers.map((s) => s || 'none').join(', ')}`);

  // Start mock server (shared across all runs)
  const mockServer = await startMockServer();
  console.log(`Mock server: ${mockServer.url}`);

  const results: { label: string; success: boolean; error?: string }[] = [];

  try {
    // Run matrix
    for (const browser of browsers) {
      for (const server of servers) {
        const result = await runWalkthrough(browser, server, mockServer);
        results.push({
          label: `${browser}-${server || 'no-server'}`,
          ...result,
        });
      }
    }
  } finally {
    await mockServer.close();

    // Cleanup test data directories
    for (const dir of ['data-test-deno', '.wrangler-test']) {
      const testDataDir = path.join(SERVER_DIR, dir);
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Walkthrough Matrix Results');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  for (const result of results) {
    const icon = result.success ? '✓' : '✗';
    console.log(`  ${icon} ${result.label}${result.error ? `: ${result.error}` : ''}`);
  }

  console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log('\nTo generate videos:');
  for (const result of results.filter((r) => r.success)) {
    console.log(
      `  ffmpeg -framerate 2 -pattern_type glob -i '${SCREENSHOTS_BASE}/${result.label}/*.png' -c:v libx264 -pix_fmt yuv420p walkthrough-${result.label}.mp4`
    );
  }
}

main();
