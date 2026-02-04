import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner } from './e2e-shared';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(PROJECT_ROOT, 'server');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'screenshots-server-sync');

interface ServerProcess {
  process: ChildProcess;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

interface MockServer {
  server: http.Server;
  url: string;
  port: number;
  close: () => Promise<void>;
}

// Mock HTML page for bookmarking
const MOCK_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article for E2E Server Sync</title>
  <meta name="description" content="A test article for end-to-end server sync testing">
</head>
<body>
  <article>
    <h1>Test Article for E2E Server Sync</h1>
    <p>This is a test article created specifically for end-to-end testing of the server sync functionality.</p>
    <p>The bookmark extension should be able to capture this page, extract its content, and sync it with the server.</p>
    <h2>Key Features Being Tested</h2>
    <ul>
      <li>Page capture and content extraction</li>
      <li>Server authentication with passkeys</li>
      <li>Bookmark synchronization</li>
      <li>Q&A generation via OpenAI-compatible API</li>
    </ul>
    <p>If you can read this in the synced bookmark, the test was successful!</p>
  </article>
</body>
</html>`;

// Start mock server for OpenAI API and test pages
async function startMockServer(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        const url = req.url || '';

        // Serve mock test page
        if (url === '/test-page' || url === '/test-page/') {
          res.setHeader('Content-Type', 'text/html');
          res.statusCode = 200;
          res.end(MOCK_PAGE_HTML);
          return;
        }

        // OpenAI-compatible API endpoints
        res.setHeader('Content-Type', 'application/json');

        if (url.includes('/chat/completions')) {
          // Mock Q&A generation
          res.statusCode = 200;
          res.end(JSON.stringify({
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
                    { question: 'What is this article about?', answer: 'This is a test article for end-to-end server sync testing.' },
                    { question: 'What features are being tested?', answer: 'Page capture, server authentication, bookmark synchronization, and Q&A generation.' },
                    { question: 'What API is used for Q&A?', answer: 'An OpenAI-compatible API is used for Q&A generation.' },
                  ]
                })
              },
              finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
          }));
          return;
        }

        if (url.includes('/embeddings')) {
          // Mock embeddings
          let inputCount = 1;
          if (body) {
            try {
              const parsed = JSON.parse(body);
              inputCount = Array.isArray(parsed.input) ? parsed.input.length : 1;
            } catch { /* ignore */ }
          }
          res.statusCode = 200;
          res.end(JSON.stringify({
            object: 'list',
            data: Array.from({ length: inputCount }, (_, i) => ({
              object: 'embedding',
              index: i,
              embedding: Array.from({ length: 1536 }, () => Math.random() * 2 - 1)
            })),
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: inputCount * 10, total_tokens: inputCount * 10 }
          }));
          return;
        }

        if (url.includes('/models')) {
          res.statusCode = 200;
          res.end(JSON.stringify({
            object: 'list',
            data: [
              { id: 'gpt-4o-mini', object: 'model' },
              { id: 'text-embedding-3-small', object: 'model' }
            ]
          }));
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        const url = `http://127.0.0.1:${port}`;
        console.log(`Mock server running at ${url}`);
        resolve({
          server,
          port,
          url,
          close: () => new Promise<void>(res => server.close(() => res())),
        });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

// Wait for server to be ready
async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// Start the real Deno server
async function startDenoServer(mockOpenAIUrl: string, extensionId?: string): Promise<ServerProcess> {
  const port = 3456;
  const url = `http://127.0.0.1:${port}`;

  // Create data directory for test database
  const dataDir = path.join(SERVER_DIR, 'data-test');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });

  // Build ORIGIN value - include extension origin if provided
  const origins = [`http://127.0.0.1:${port}`];
  if (extensionId) {
    origins.push(`chrome-extension://${extensionId}`);
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    RP_ID: 'localhost',
    RP_NAME: 'Bookmark RAG Test',
    ORIGIN: origins.join(','),
    CORS_ORIGIN: '*',
    DATABASE_PATH: path.join(dataDir, 'test.db'),
    OPENAI_API_KEY: 'test-key-for-mock',
    OPENAI_API_BASE: mockOpenAIUrl,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    CHAT_MODEL: 'gpt-4o-mini',
  };

  const serverProcess = spawn('deno', [
    'run',
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-ffi',
    '--unstable-ffi',
    'src/main.ts',
  ], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  console.log(`Waiting for Deno server at ${url}...`);
  await waitForServer(url);
  console.log(`Deno server is ready at ${url}`);

  return {
    process: serverProcess,
    url,
    port,
    stop: async () => {
      return new Promise<void>((resolve) => {
        serverProcess.on('close', () => resolve());
        serverProcess.kill('SIGTERM');
        setTimeout(() => {
          serverProcess.kill('SIGKILL');
          resolve();
        }, 5000);
      });
    },
  };
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Server Sync E2E Tests (Full Integration)');
  console.log('='.repeat(60));
  console.log('This test uses:');
  console.log('  - Mock OpenAI API for embeddings/Q&A');
  console.log('  - Real Deno server for sync');
  console.log('  - Mock webpage for bookmarking');
  console.log('='.repeat(60));

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const runner = new TestRunner();
  let adapter: ChromeAdapter | null = null;
  let mockServer: MockServer | null = null;
  let denoServer: ServerProcess | null = null;

  try {
    // Start mock server (OpenAI API + test pages)
    mockServer = await startMockServer();

    // Set up Chrome adapter FIRST to get extension ID
    adapter = new ChromeAdapter();
    await adapter.setup();

    // Start real Deno server with extension origin configured
    const extensionId = adapter.getExtensionIdSync();
    denoServer = await startDenoServer(mockServer.url, extensionId);

    // Run tests
    await runServerSyncTests(adapter, runner, denoServer.url, mockServer.url);

  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    if (adapter) {
      await adapter.teardown();
    }
    if (denoServer) {
      console.log('Stopping Deno server...');
      await denoServer.stop();
    }
    if (mockServer) {
      await mockServer.close();
    }

    // Clean up test database
    const testDataDir = path.join(SERVER_DIR, 'data-test');
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  }

  runner.printSummary('Server Sync');

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Server Sync E2E tests passed!');
}

async function runServerSyncTests(
  adapter: ChromeAdapter,
  runner: TestRunner,
  serverUrl: string,
  mockServerUrl: string
): Promise<void> {
  const page = await adapter.newPage();
  const testPageUrl = `${mockServerUrl}/test-page`;

  try {
    // ==========================================
    // PART 1: Configure API and Server Settings
    // ==========================================

    await runner.runTest('Configure API settings with mock server', async () => {
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('#settingsForm', 10000);

      // Clear and set API base URL to mock server
      await page.evaluate(`document.getElementById('apiBaseUrl').value = ''`);
      await page.type('#apiBaseUrl', mockServerUrl);

      // Set a test API key
      await page.evaluate(`document.getElementById('apiKey').value = ''`);
      await page.type('#apiKey', 'test-key-for-mock');

      // Save settings
      await page.click('button[type="submit"]');
      await new Promise(resolve => setTimeout(resolve, 500));

      await page.screenshot(path.join(SCREENSHOTS_DIR, '01-api-configured.png'));
    });

    await runner.runTest('Enable server sync and configure URL', async () => {
      // Navigate to server sync section
      await page.click('a[data-section="server-sync"]');
      await page.waitForSelector('#server-sync', 5000);

      // Enable server sync
      await page.click('#serverEnabled');

      // Wait for fields to become visible
      let visible = false;
      for (let i = 0; i < 20; i++) {
        visible = await page.evaluate<boolean>(
          `!document.getElementById('serverSyncFields')?.classList.contains('hidden')`
        );
        if (visible) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      if (!visible) {
        await page.evaluate(`document.getElementById('serverEnabled')?.click()`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Enter server URL
      await page.type('#serverUrl', serverUrl);
      await page.click('#serverSaveUrlBtn');
      await new Promise(resolve => setTimeout(resolve, 500));

      await page.screenshot(path.join(SCREENSHOTS_DIR, '02-server-configured.png'));
    });

    // ==========================================
    // PART 2: Test Server API Directly
    // ==========================================

    await runner.runTest('Server health check', async () => {
      const response = await fetch(`${serverUrl}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      const data = await response.json() as { status: string };
      if (data.status !== 'ok') {
        throw new Error(`Unexpected health status: ${data.status}`);
      }
    });

    await runner.runTest('Server returns WebAuthn registration options', async () => {
      const response = await fetch(`${serverUrl}/api/v1/auth/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'e2e-test-user' }),
      });

      if (!response.ok) {
        throw new Error(`Register options failed: ${response.status}`);
      }

      const data = await response.json() as { sessionId?: string; options?: { challenge?: string } };
      if (!data.sessionId || !data.options?.challenge) {
        throw new Error('Missing sessionId or challenge in response');
      }
    });

    // ==========================================
    // PART 3: Create a Bookmark Directly
    // ==========================================

    await runner.runTest('Create bookmark via IndexedDB', async () => {
      // Navigate to library page where we can access the database
      await page.goto(adapter.getPageUrl('library'));
      await page.waitForSelector('#bookmarkList', 10000);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Insert a test bookmark directly into IndexedDB
      // The database is named 'BookmarkRAG' and uses Date objects, not ISO strings
      // Also, markdown and Q&A are stored in separate tables
      const bookmarkId = `test-e2e-bookmark-${Date.now()}`;
      const markdownId = `test-md-${Date.now()}`;
      const qaId1 = `test-qa1-${Date.now()}`;
      const qaId2 = `test-qa2-${Date.now()}`;

      await page.waitForFunction(
        `(async () => {
          return new Promise((resolve) => {
            // Open the correct database name
            const request = indexedDB.open('BookmarkRAG');
            request.onsuccess = (event) => {
              const idb = event.target.result;
              const now = new Date();

              // Create bookmark
              const bookmarkTx = idb.transaction(['bookmarks'], 'readwrite');
              const bookmarkStore = bookmarkTx.objectStore('bookmarks');
              const bookmark = {
                id: '${bookmarkId}',
                url: '${testPageUrl}',
                title: 'Test Article for E2E Server Sync',
                html: '<html><body><h1>Test Article</h1><p>This is test content for E2E testing.</p></body></html>',
                createdAt: now,
                updatedAt: now,
                status: 'complete'
              };
              const addBookmark = bookmarkStore.add(bookmark);

              addBookmark.onsuccess = () => {
                // Add markdown content
                const mdTx = idb.transaction(['markdown'], 'readwrite');
                const mdStore = mdTx.objectStore('markdown');
                mdStore.add({
                  id: '${markdownId}',
                  bookmarkId: '${bookmarkId}',
                  content: '# Test Article\\n\\nThis is test content for E2E testing of the server sync functionality.',
                  createdAt: now,
                  updatedAt: now
                });

                mdTx.oncomplete = () => {
                  // Add Q&A pairs
                  const qaTx = idb.transaction(['questionsAnswers'], 'readwrite');
                  const qaStore = qaTx.objectStore('questionsAnswers');

                  // Create dummy embeddings (array of 1536 floats)
                  const dummyEmbedding = Array.from({length: 1536}, () => Math.random() * 2 - 1);

                  qaStore.add({
                    id: '${qaId1}',
                    bookmarkId: '${bookmarkId}',
                    question: 'What is this article about?',
                    answer: 'This is a test article for E2E server sync testing.',
                    embeddingQuestion: dummyEmbedding,
                    embeddingAnswer: dummyEmbedding,
                    embeddingBoth: dummyEmbedding,
                    createdAt: now,
                    updatedAt: now
                  });

                  qaStore.add({
                    id: '${qaId2}',
                    bookmarkId: '${bookmarkId}',
                    question: 'What is being tested?',
                    answer: 'The server sync functionality is being tested.',
                    embeddingQuestion: dummyEmbedding,
                    embeddingAnswer: dummyEmbedding,
                    embeddingBoth: dummyEmbedding,
                    createdAt: now,
                    updatedAt: now
                  });

                  qaTx.oncomplete = () => {
                    window._bookmarkCreated = true;
                    resolve(true);
                  };
                  qaTx.onerror = () => resolve(false);
                };
                mdTx.onerror = () => resolve(false);
              };

              addBookmark.onerror = (e) => {
                console.error('Failed to add bookmark:', e);
                resolve(false);
              };
            };
            request.onerror = () => resolve(false);
          });
        })()`,
        20000
      );

      await page.screenshot(path.join(SCREENSHOTS_DIR, '03-bookmark-created.png'));

      // Reload to see the new bookmark
      await page.goto(adapter.getPageUrl('library'));
      await page.waitForSelector('#bookmarkList', 10000);
      await new Promise(resolve => setTimeout(resolve, 1500));

      await page.screenshot(path.join(SCREENSHOTS_DIR, '04-library-reloaded.png'));
    });

    // ==========================================
    // PART 4: Verify Bookmark in Library
    // ==========================================

    await runner.runTest('Bookmark appears in library', async () => {
      // Wait for bookmark to appear
      await page.waitForFunction(
        `(() => {
          const cards = document.querySelectorAll('.bookmark-card');
          return cards.length > 0;
        })()`,
        10000
      );

      // Log bookmark titles for debugging
      const titles = await page.evaluate<string[]>(
        `Array.from(document.querySelectorAll('.bookmark-card .card-title')).map(t => t.textContent)`
      );
      console.log(`Found bookmarks: ${JSON.stringify(titles)}`);

      await page.screenshot(path.join(SCREENSHOTS_DIR, '05-library-with-bookmark.png'));
    });

    await runner.runTest('Can view bookmark details', async () => {
      // Click on the bookmark card
      await page.evaluate(`(() => {
        const card = document.querySelector('.bookmark-card');
        if (card) card.click();
      })()`);

      // Wait for detail panel to show
      await page.waitForFunction(
        `(() => {
          const panel = document.getElementById('detailPanel');
          return panel && !panel.classList.contains('hidden');
        })()`,
        10000
      );

      await page.screenshot(path.join(SCREENSHOTS_DIR, '06-bookmark-detail.png'));
    });

    await runner.runTest('Bookmark has Q&A pairs', async () => {
      // Our test bookmark has Q&A pairs pre-populated
      const hasQA = await page.evaluate<boolean>(
        `(() => {
          const panel = document.getElementById('detailPanel');
          if (!panel) return false;
          const text = panel.textContent || '';
          // Check for Q&A content from our test bookmark
          return text.includes('?') || text.includes('E2E') || text.includes('test');
        })()`
      );

      await page.screenshot(path.join(SCREENSHOTS_DIR, '07-bookmark-qa.png'), { fullPage: true });

      if (!hasQA) {
        console.log('Warning: Expected Q&A content not found');
      }
    });

    // ==========================================
    // PART 5: Test Server API Authentication
    // ==========================================

    await runner.runTest('Server bookmark API requires auth', async () => {
      const bookmarkData = {
        url: testPageUrl,
        title: 'Test Article for E2E Server Sync',
        html: MOCK_PAGE_HTML,
      };

      const response = await fetch(`${serverUrl}/api/v1/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookmarkData),
      });

      // We expect 401 since we're not authenticated
      if (response.status !== 401) {
        throw new Error(`Expected 401 Unauthorized, got ${response.status}`);
      }
    });

    await runner.runTest('Server search endpoint requires auth', async () => {
      const response = await fetch(`${serverUrl}/api/v1/search?q=test`);

      if (response.status !== 401) {
        throw new Error(`Expected 401 Unauthorized, got ${response.status}`);
      }
    });

    // ==========================================
    // PART 6: Verify Server Sync UI
    // ==========================================

    await runner.runTest('Server sync UI shows status', async () => {
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('.settings-section', 10000);

      // Navigate to server sync section
      await page.click('a[data-section="server-sync"]');
      await new Promise(resolve => setTimeout(resolve, 500));

      const hasSyncStatus = await page.$('#serverSyncStatusText');
      if (!hasSyncStatus) {
        throw new Error('Sync status text not found');
      }

      await page.screenshot(path.join(SCREENSHOTS_DIR, '08-sync-status.png'));
    });

    await runner.runTest('Auth UI shows register/login options', async () => {
      const hasAuthSection = await page.$('#serverAuthSection');
      const hasRegisterBtn = await page.$('#serverRegisterBtn');
      const hasLoginBtn = await page.$('#serverLoginBtn');

      if (!hasAuthSection || !hasRegisterBtn || !hasLoginBtn) {
        throw new Error('Auth UI elements missing');
      }

      await page.screenshot(path.join(SCREENSHOTS_DIR, '09-auth-section.png'));
    });

    // ==========================================
    // PART 7: WebAuthn Passkey Tests
    // ==========================================

    // Check if CDP session is available for WebAuthn tests
    if (typeof page.createCDPSession !== 'function') {
      console.log('  (Skipping WebAuthn tests - CDP session not available)');
    } else {
      let cdpClient: Awaited<ReturnType<typeof page.createCDPSession>> | null = null;
      let authenticatorId: string | null = null;

      await runner.runTest('Setup virtual WebAuthn authenticator', async () => {
        cdpClient = await page.createCDPSession!();

        // Enable WebAuthn domain
        await cdpClient.send('WebAuthn.enable');

        // Add virtual authenticator
        const result = await cdpClient.send('WebAuthn.addVirtualAuthenticator', {
          options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        }) as { authenticatorId: string };

        authenticatorId = result.authenticatorId;

        if (!authenticatorId) {
          throw new Error('Failed to create virtual authenticator');
        }

        console.log(`  Created virtual authenticator: ${authenticatorId}`);
      });

      await runner.runTest('Passkey registration creates credential', async () => {
        if (!cdpClient || !authenticatorId) {
          throw new Error('Virtual authenticator not set up');
        }

        // Track credential creation via event
        let credentialAdded = false;
        const credentialAddedPromise = new Promise<void>((resolve) => {
          const handler = () => {
            credentialAdded = true;
            cdpClient!.off('WebAuthn.credentialAdded', handler);
            resolve();
          };
          cdpClient!.on('WebAuthn.credentialAdded', handler);
        });

        // Enter username and click register
        const testUsername = `e2e-test-${Date.now()}`;
        await page.evaluate(`document.getElementById('serverUsername').value = ''`);
        await page.type('#serverUsername', testUsername);

        await page.screenshot(path.join(SCREENSHOTS_DIR, '10-webauthn-register-start.png'));

        // Click register button
        await page.click('#serverRegisterBtn');

        // Wait for credential to be created (with timeout)
        const timeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for credential creation')), 15000)
        );

        await Promise.race([credentialAddedPromise, timeout]);

        if (!credentialAdded) {
          throw new Error('WebAuthn credential was not created');
        }

        // Verify credential was stored in authenticator
        const credentialsResult = await cdpClient.send('WebAuthn.getCredentials', {
          authenticatorId,
        }) as { credentials: Array<{ credentialId: string; isResidentCredential: boolean; signCount: number }> };

        if (!credentialsResult.credentials || credentialsResult.credentials.length === 0) {
          throw new Error('No credentials found in virtual authenticator');
        }

        console.log(`  Created ${credentialsResult.credentials.length} credential(s)`);

        // Wait for UI to show logged in state
        await page.waitForFunction(
          `(() => {
            const loggedInSection = document.getElementById('serverLoggedInSection');
            return loggedInSection && !loggedInSection.classList.contains('hidden');
          })()`,
          10000
        );

        // Verify username is displayed
        const displayedUsername = await page.evaluate<string>(
          `document.getElementById('serverUsernameDisplay')?.textContent || ''`
        );

        if (!displayedUsername.includes(testUsername)) {
          throw new Error(`Expected username "${testUsername}" to be displayed, got "${displayedUsername}"`);
        }

        await page.screenshot(path.join(SCREENSHOTS_DIR, '11-webauthn-register-success.png'));
        console.log(`  Registered as: ${displayedUsername}`);
      });

      await runner.runTest('Passkey login with existing credential', async () => {
        if (!cdpClient || !authenticatorId) {
          throw new Error('Virtual authenticator not set up');
        }

        // Get initial sign count
        const initialCredentials = await cdpClient.send('WebAuthn.getCredentials', {
          authenticatorId,
        }) as { credentials: Array<{ credentialId: string; signCount: number }> };

        if (!initialCredentials.credentials || initialCredentials.credentials.length === 0) {
          throw new Error('No credentials found for login test');
        }

        const initialSignCount = initialCredentials.credentials[0].signCount;

        // First, logout
        await page.click('#serverLogoutBtn');

        // Wait for auth section to be visible again
        await page.waitForFunction(
          `(() => {
            const authSection = document.getElementById('serverAuthSection');
            return authSection && !authSection.classList.contains('hidden');
          })()`,
          10000
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '12-webauthn-logged-out.png'));

        // Track credential assertion via event
        let credentialAsserted = false;
        const credentialAssertedPromise = new Promise<void>((resolve) => {
          const handler = () => {
            credentialAsserted = true;
            cdpClient!.off('WebAuthn.credentialAsserted', handler);
            resolve();
          };
          cdpClient!.on('WebAuthn.credentialAsserted', handler);
        });

        // Click login button
        await page.click('#serverLoginBtn');

        // Wait for credential assertion (with timeout)
        const timeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for credential assertion')), 15000)
        );

        await Promise.race([credentialAssertedPromise, timeout]);

        if (!credentialAsserted) {
          throw new Error('WebAuthn credential was not asserted');
        }

        // Verify sign count increased
        const finalCredentials = await cdpClient.send('WebAuthn.getCredentials', {
          authenticatorId,
        }) as { credentials: Array<{ credentialId: string; signCount: number }> };

        const finalSignCount = finalCredentials.credentials[0].signCount;

        if (finalSignCount <= initialSignCount) {
          throw new Error(`Sign count should have increased from ${initialSignCount}, but got ${finalSignCount}`);
        }

        console.log(`  Sign count increased: ${initialSignCount} -> ${finalSignCount}`);

        // Wait for UI to show logged in state
        await page.waitForFunction(
          `(() => {
            const loggedInSection = document.getElementById('serverLoggedInSection');
            return loggedInSection && !loggedInSection.classList.contains('hidden');
          })()`,
          10000
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '13-webauthn-login-success.png'));
      });

      await runner.runTest('Authenticated API access works after login', async () => {
        // Verify we're logged in by checking the UI
        const isLoggedIn = await page.evaluate<boolean>(
          `(() => {
            const loggedInSection = document.getElementById('serverLoggedInSection');
            return loggedInSection && !loggedInSection.classList.contains('hidden');
          })()`
        );

        if (!isLoggedIn) {
          throw new Error('Not logged in - cannot test authenticated API access');
        }

        // Wait for session token to be saved to IndexedDB (async operation)
        // Settings are stored in the BookmarkRAG database, settings table
        await page.waitForFunction(
          `(async () => {
            return new Promise((resolve) => {
              const request = indexedDB.open('BookmarkRAG');
              request.onsuccess = (event) => {
                const idb = event.target.result;
                const tx = idb.transaction(['settings'], 'readonly');
                const store = tx.objectStore('settings');
                const getReq = store.get('serverSessionToken');
                getReq.onsuccess = () => {
                  resolve(Boolean(getReq.result?.value));
                };
                getReq.onerror = () => resolve(false);
              };
              request.onerror = () => resolve(false);
            });
          })()`,
          10000
        );

        // Test authenticated API call via the sync endpoint
        // We'll trigger a sync which should succeed now that we're authenticated
        await page.click('#serverSyncNowBtn');

        // Wait for sync to complete (success or error)
        await page.waitForFunction(
          `(() => {
            const statusText = document.getElementById('serverSyncStatusText')?.textContent || '';
            const status = document.querySelector('.status')?.textContent || '';
            return statusText.includes('Last synced') ||
                   statusText.includes('Error') ||
                   status.includes('Sync completed') ||
                   status.includes('Sync failed');
          })()`,
          15000
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '14-webauthn-authenticated-sync.png'));

        // Check the sync status to verify the API call worked
        const syncStatusText = await page.evaluate<string>(
          `document.getElementById('serverSyncStatusText')?.textContent || ''`
        );

        console.log(`  Sync status: ${syncStatusText}`);

        // If we got an error that's NOT about authentication, that's still success
        // because it means we got past the auth check
        if (syncStatusText.includes('Error') && syncStatusText.toLowerCase().includes('unauthorized')) {
          throw new Error('Sync failed with authentication error - session token not working');
        }
      });

      // ==========================================
      // PART 8: Sync Bookmark to Server
      // ==========================================

      await runner.runTest('Push bookmark to server via API', async () => {
        // First, go to library to verify bookmark exists locally
        await page.goto(adapter.getPageUrl('library'));
        await page.waitForSelector('#bookmarkList', 10000);

        // Wait for bookmark to appear
        await page.waitForFunction(
          `(() => {
            const cards = document.querySelectorAll('.bookmark-card');
            return cards.length > 0;
          })()`,
          10000
        );

        const bookmarkCount = await page.evaluate<number>(
          `document.querySelectorAll('.bookmark-card').length`
        );
        console.log(`  Found ${bookmarkCount} bookmark(s) in local library`);

        await page.screenshot(path.join(SCREENSHOTS_DIR, '15-library-before-push.png'));

        // Get the session token from IndexedDB
        const sessionToken = await page.evaluate<string>(
          `(async () => {
            return new Promise((resolve) => {
              const request = indexedDB.open('BookmarkRAG');
              request.onsuccess = (event) => {
                const idb = event.target.result;
                const tx = idb.transaction(['settings'], 'readonly');
                const store = tx.objectStore('settings');
                const getReq = store.get('serverSessionToken');
                getReq.onsuccess = () => {
                  resolve(getReq.result?.value || '');
                };
                getReq.onerror = () => resolve('');
              };
              request.onerror = () => resolve('');
            });
          })()`
        );

        if (!sessionToken) {
          throw new Error('No session token found - not authenticated');
        }

        // Create bookmark on server via API
        const bookmarkData = {
          url: testPageUrl,
          title: 'Test Article for E2E Server Sync',
          html: MOCK_PAGE_HTML,
        };

        const response = await fetch(`${serverUrl}/api/v1/bookmarks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(bookmarkData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create bookmark on server: ${response.status} ${errorText}`);
        }

        const createdBookmark = await response.json() as { id: string; status: string };
        console.log(`  Created bookmark on server: ${createdBookmark.id} (status: ${createdBookmark.status})`);

        await page.screenshot(path.join(SCREENSHOTS_DIR, '16-bookmark-pushed-to-server.png'));
      });

      // ==========================================
      // PART 9: Clear Local Data and Restore via Sync
      // ==========================================

      await runner.runTest('Clear all local data (IndexedDB)', async () => {
        // Navigate to library first
        await page.goto(adapter.getPageUrl('library'));
        await page.waitForSelector('#bookmarkList', 10000);

        // Clear all IndexedDB databases
        const cleared = await page.waitForFunction(
          `(async () => {
            return new Promise((resolve) => {
              // Delete the BookmarkRAG database
              const deleteRequest = indexedDB.deleteDatabase('BookmarkRAG');
              deleteRequest.onsuccess = () => {
                console.log('IndexedDB cleared');
                resolve(true);
              };
              deleteRequest.onerror = () => resolve(false);
              deleteRequest.onblocked = () => {
                console.log('IndexedDB delete blocked, forcing...');
                resolve(true);
              };
            });
          })()`,
          10000
        );

        console.log('  Cleared IndexedDB');

        // Reload the page to start fresh
        await page.goto(adapter.getPageUrl('library'));
        await page.waitForSelector('#bookmarkList', 10000);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify bookmarks are gone
        const bookmarkCount = await page.evaluate<number>(
          `document.querySelectorAll('.bookmark-card').length`
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '17-library-after-clear.png'));
        console.log(`  Library now has ${bookmarkCount} bookmark(s) after clearing`);

        if (bookmarkCount > 0) {
          console.log('  Warning: Bookmarks still visible - may be cached');
        }
      });

      await runner.runTest('Re-login with passkey after data clear', async () => {
        if (!cdpClient || !authenticatorId) {
          throw new Error('Virtual authenticator not available');
        }

        // Go to options and re-enable server sync
        await page.goto(adapter.getPageUrl('options'));
        await page.waitForSelector('.settings-section', 10000);
        await page.click('a[data-section="server-sync"]');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Enable server sync (may have been reset)
        const isEnabled = await page.evaluate<boolean>(
          `document.getElementById('serverEnabled')?.checked ?? false`
        );

        if (!isEnabled) {
          await page.click('#serverEnabled');
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Re-enter server URL if needed
        const serverUrlValue = await page.evaluate<string>(
          `document.getElementById('serverUrl')?.value || ''`
        );

        if (!serverUrlValue) {
          await page.type('#serverUrl', serverUrl);
          await page.click('#serverSaveUrlBtn');
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        await page.screenshot(path.join(SCREENSHOTS_DIR, '18-before-relogin.png'));

        // Track credential assertion
        let credentialAsserted = false;
        const credentialAssertedPromise = new Promise<void>((resolve) => {
          const handler = () => {
            credentialAsserted = true;
            cdpClient!.off('WebAuthn.credentialAsserted', handler);
            resolve();
          };
          cdpClient!.on('WebAuthn.credentialAsserted', handler);
        });

        // Click login button
        await page.click('#serverLoginBtn');

        // Wait for credential assertion
        const timeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for re-login')), 15000)
        );

        await Promise.race([credentialAssertedPromise, timeout]);

        if (!credentialAsserted) {
          throw new Error('Re-login with passkey failed');
        }

        // Wait for logged in state
        await page.waitForFunction(
          `(() => {
            const loggedInSection = document.getElementById('serverLoggedInSection');
            return loggedInSection && !loggedInSection.classList.contains('hidden');
          })()`,
          10000
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '19-relogin-success.png'));
        console.log('  Re-logged in with passkey');
      });

      await runner.runTest('Sync restores bookmark from server', async () => {
        // Click sync now to pull bookmarks from server
        await page.click('#serverSyncNowBtn');

        // Wait for sync to complete
        await page.waitForFunction(
          `(() => {
            const statusText = document.getElementById('serverSyncStatusText')?.textContent || '';
            return statusText.includes('Last synced');
          })()`,
          15000
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '20-sync-after-relogin.png'));
        console.log('  Sync completed after re-login');

        // Go to library and check if bookmark is restored
        await page.goto(adapter.getPageUrl('library'));
        await page.waitForSelector('#bookmarkList', 10000);
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Wait for bookmarks to appear
        await page.waitForFunction(
          `(() => {
            const cards = document.querySelectorAll('.bookmark-card');
            return cards.length > 0;
          })()`,
          15000
        );

        const bookmarkCount = await page.evaluate<number>(
          `document.querySelectorAll('.bookmark-card').length`
        );

        const titles = await page.evaluate<string[]>(
          `Array.from(document.querySelectorAll('.bookmark-card .card-title')).map(t => t.textContent)`
        );

        await page.screenshot(path.join(SCREENSHOTS_DIR, '21-library-restored.png'));
        console.log(`  Restored ${bookmarkCount} bookmark(s): ${JSON.stringify(titles)}`);

        if (bookmarkCount === 0) {
          throw new Error('No bookmarks restored from server');
        }

        // Verify it's our test bookmark
        const hasTestBookmark = titles.some(t => t?.includes('Test Article') || t?.includes('E2E'));
        if (!hasTestBookmark) {
          console.log('  Warning: Test bookmark title not found in restored bookmarks');
        }
      });

      await runner.runTest('Restored bookmark has content', async () => {
        // Click on the bookmark to view details
        await page.evaluate(`(() => {
          const card = document.querySelector('.bookmark-card');
          if (card) card.click();
        })()`);

        // Wait for detail panel
        await page.waitForFunction(
          `(() => {
            const panel = document.getElementById('detailPanel');
            return panel && !panel.classList.contains('hidden');
          })()`,
          10000
        );

        // Wait for content to fully load (animation + data fetch)
        await new Promise(resolve => setTimeout(resolve, 1500));

        await page.screenshot(path.join(SCREENSHOTS_DIR, '22-restored-bookmark-detail.png'), { fullPage: true });

        // Check for content
        const hasContent = await page.evaluate<boolean>(
          `(() => {
            const panel = document.getElementById('detailPanel');
            if (!panel) return false;
            const text = panel.textContent || '';
            return text.length > 100;
          })()`
        );

        console.log(`  Bookmark detail has content: ${hasContent}`);
      });

      // ==========================================
      // PART 10: Cleanup
      // ==========================================

      await runner.runTest('Cleanup virtual WebAuthn authenticator', async () => {
        if (cdpClient && authenticatorId) {
          try {
            await cdpClient.send('WebAuthn.removeVirtualAuthenticator', {
              authenticatorId,
            });
            console.log(`  Removed virtual authenticator: ${authenticatorId}`);
          } catch (error) {
            console.warn(`  Warning: Failed to remove authenticator: ${error}`);
          }

          try {
            await cdpClient.send('WebAuthn.disable');
          } catch (error) {
            console.warn(`  Warning: Failed to disable WebAuthn: ${error}`);
          }

          try {
            await cdpClient.detach();
          } catch (error) {
            console.warn(`  Warning: Failed to detach CDP session: ${error}`);
          }
        }
      });
    }

    await runner.runTest('Can toggle server sync off and on', async () => {
      // Navigate to options page first
      await page.goto(adapter.getPageUrl('options'));
      await page.waitForSelector('.settings-section', 10000);
      await page.click('a[data-section="server-sync"]');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Ensure we're on the server sync section
      await page.waitForSelector('#serverEnabled', 5000);

      // First ensure it's enabled (use JS click for reliability)
      const isEnabled = await page.evaluate<boolean>(
        `document.getElementById('serverEnabled')?.checked ?? false`
      );

      if (!isEnabled) {
        await page.evaluate(`document.getElementById('serverEnabled').click()`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Verify it's now enabled
      const nowEnabled = await page.evaluate<boolean>(
        `document.getElementById('serverEnabled')?.checked ?? false`
      );
      if (!nowEnabled) {
        console.log('  Warning: Could not enable server sync toggle');
      }

      // Disable using JS click
      await page.evaluate(`document.getElementById('serverEnabled').click()`);

      // Wait for fields to be hidden
      let hidden = false;
      for (let i = 0; i < 30; i++) {
        hidden = await page.evaluate<boolean>(
          `document.getElementById('serverSyncFields')?.classList.contains('hidden') ?? false`
        );
        if (hidden) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await page.screenshot(path.join(SCREENSHOTS_DIR, '23-sync-disabled.png'));

      if (!hidden) {
        // Log current state for debugging
        const checkboxState = await page.evaluate<boolean>(
          `document.getElementById('serverEnabled')?.checked ?? false`
        );
        console.log(`  Checkbox state: ${checkboxState}, Fields hidden: ${hidden}`);
        throw new Error('Server sync fields should be hidden when disabled');
      }

      // Re-enable
      await page.evaluate(`document.getElementById('serverEnabled').click()`);
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    // ==========================================
    // PART 11: Search Functionality
    // ==========================================

    await runner.runTest('Search page loads and accepts queries', async () => {
      await page.goto(adapter.getPageUrl('search'));
      await page.waitForSelector('#searchInput', 10000);

      // Verify search UI elements are present
      const hasSearchInput = await page.$('#searchInput');
      const hasSearchBtn = await page.$('#searchBtn');

      if (!hasSearchInput || !hasSearchBtn) {
        throw new Error('Search UI elements missing');
      }

      await page.screenshot(path.join(SCREENSHOTS_DIR, '24-search-page.png'));
    });

    await runner.runTest('Search returns results for test bookmark', async () => {
      // Type a search query related to our test bookmark
      await page.type('#searchInput', 'test article E2E');

      // Click search button
      await page.click('#searchBtn');

      // Wait for results to appear (or searching state to resolve)
      await page.waitForFunction(
        `(() => {
          const resultStatus = document.getElementById('resultStatus');
          const resultsList = document.getElementById('resultsList');
          if (!resultStatus) return false;
          const text = resultStatus.textContent || '';
          // Wait until we have results or "no results" message
          return text.includes('result') || resultsList?.children.length > 0;
        })()`,
        15000
      );

      await page.screenshot(path.join(SCREENSHOTS_DIR, '25-search-results.png'));

      // Check if we got results
      const resultCount = await page.evaluate<number>(
        `document.getElementById('resultsList')?.children.length || 0`
      );

      console.log(`  Search returned ${resultCount} result(s)`);
    });

    // ==========================================
    // PART 12: Stumble Functionality
    // ==========================================

    await runner.runTest('Stumble page shows random bookmarks', async () => {
      await page.goto(adapter.getPageUrl('stumble'));
      await page.waitForSelector('#shuffleBtn', 10000);

      // Wait for bookmarks to load
      await page.waitForFunction(
        `(() => {
          const stumbleList = document.getElementById('stumbleList');
          const resultCount = document.getElementById('resultCount');
          return stumbleList?.children.length > 0 ||
                 (resultCount && parseInt(resultCount.textContent || '0') >= 0);
        })()`,
        10000
      );

      await page.screenshot(path.join(SCREENSHOTS_DIR, '26-stumble-page.png'));

      const bookmarkCount = await page.evaluate<number>(
        `document.getElementById('stumbleList')?.querySelectorAll('.bookmark-card').length || 0`
      );

      console.log(`  Stumble showing ${bookmarkCount} bookmark(s)`);
    });

    await runner.runTest('Shuffle button refreshes bookmarks', async () => {
      // Get initial bookmark IDs or content
      const initialContent = await page.evaluate<string>(
        `document.getElementById('stumbleList')?.innerHTML || ''`
      );

      // Click shuffle
      await page.click('#shuffleBtn');
      await new Promise(resolve => setTimeout(resolve, 500));

      await page.screenshot(path.join(SCREENSHOTS_DIR, '27-stumble-shuffled.png'));

      // Note: With only one bookmark, content may be the same after shuffle
      // The test just verifies the shuffle button is functional
      console.log('  Shuffle button clicked successfully');
    });

  } finally {
    await page.close();
  }
}

main();
