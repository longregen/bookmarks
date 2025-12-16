/**
 * Chrome Extension E2E Test Adapter
 *
 * Uses Puppeteer to test the Chrome extension.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import {
  TestAdapter,
  PageHandle,
  getMockQAPairsResponse,
  getMockEmbeddingsResponse,
  getMockModelsResponse,
} from '../e2e-shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ChromeAdapter implements TestAdapter {
  platformName = 'Chrome Extension';
  isExtension = true;

  private browser: Browser | null = null;
  private extensionId: string = '';
  private mockServer: http.Server | null = null;
  private mockServerPort: number = 0;
  private userDataDir: string = '';

  private extensionPath: string;
  private browserPath: string;
  private apiKey: string;

  constructor() {
    this.extensionPath = process.env.EXTENSION_PATH
      ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
      : path.resolve(__dirname, '../../dist-chrome');
    this.browserPath = process.env.BROWSER_PATH || '';
    this.apiKey = process.env.OPENAI_API_KEY || '';

    if (!this.browserPath) {
      throw new Error('BROWSER_PATH environment variable is required');
    }
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    if (!fs.existsSync(this.extensionPath)) {
      throw new Error(`Extension path does not exist: ${this.extensionPath}`);
    }
  }

  async setup(): Promise<void> {
    // Start mock server
    await this.startMockServer();

    // Create temp user data directory
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-profile-'));

    // Launch browser with extension
    this.browser = await puppeteer.launch({
      executablePath: this.browserPath,
      headless: false, // Extensions require headed mode
      args: [
        `--user-data-dir=${this.userDataDir}`,
        `--disable-extensions-except=${this.extensionPath}`,
        `--load-extension=${this.extensionPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    // Get extension ID
    this.extensionId = await this.getExtensionId();
    console.log(`Extension ID: ${this.extensionId}`);
  }

  async teardown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }

    if (this.mockServer) {
      await new Promise<void>(resolve => {
        this.mockServer!.close(() => resolve());
      });
    }

    // Cleanup user data directory
    if (this.userDataDir && fs.existsSync(this.userDataDir)) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async newPage(): Promise<PageHandle> {
    const page = await this.browser!.newPage();
    return new PuppeteerPageHandle(page);
  }

  getPageUrl(pageName: 'library' | 'search' | 'options' | 'stumble' | 'popup' | 'index' | 'jobs'): string {
    const paths: Record<string, string> = {
      library: '/src/library/library.html',
      search: '/src/search/search.html',
      options: '/src/options/options.html',
      stumble: '/src/stumble/stumble.html',
      jobs: '/src/jobs/jobs.html',
      popup: '/src/popup/popup.html',
      index: '/src/popup/popup.html', // Chrome extension uses popup as main entry
    };
    return `chrome-extension://${this.extensionId}${paths[pageName]}`;
  }

  getMockApiUrl(): string {
    return `http://127.0.0.1:${this.mockServerPort}`;
  }

  getRealApiKey(): string {
    return this.apiKey;
  }

  private async getExtensionId(): Promise<string> {
    const EXTENSION_TIMEOUT = 30000;

    try {
      // Find the service worker target
      const serviceWorkerTarget = await this.browser!.waitForTarget(
        target => {
          const targetType = target.type();
          const url = target.url();
          return targetType === 'service_worker' && url.includes('chrome-extension://');
        },
        { timeout: EXTENSION_TIMEOUT }
      );

      const url = serviceWorkerTarget.url();
      const match = url.match(/chrome-extension:\/\/([^/]+)/);

      if (match) {
        return match[1];
      }
    } catch {
      console.log('Service worker target not found, trying fallback methods...');
    }

    // Fallback: Look for any chrome-extension:// target
    try {
      const extensionTarget = await this.browser!.waitForTarget(
        target => target.url().includes('chrome-extension://'),
        { timeout: 10000 }
      );

      const url = extensionTarget.url();
      const match = url.match(/chrome-extension:\/\/([^/]+)/);

      if (match) {
        return match[1];
      }
    } catch {
      // Continue to final fallback
    }

    // Final fallback: Check all existing targets
    const targets = this.browser!.targets();
    const extensionTarget = targets.find(target =>
      target.url().includes('chrome-extension://')
    );

    if (!extensionTarget) {
      throw new Error('Extension not found');
    }

    const url = extensionTarget.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);

    if (!match) {
      throw new Error('Could not extract extension ID');
    }

    return match[1];
  }

  private async startMockServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.setHeader('Content-Type', 'application/json');

          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }

          const url = req.url || '';

          if (url.includes('/chat/completions')) {
            res.statusCode = 200;
            res.end(JSON.stringify(getMockQAPairsResponse()));
          } else if (url.includes('/embeddings')) {
            let inputCount = 1;
            if (body) {
              try {
                const parsed = JSON.parse(body);
                inputCount = Array.isArray(parsed.input) ? parsed.input.length : 1;
              } catch { /* default */ }
            }
            res.statusCode = 200;
            res.end(JSON.stringify(getMockEmbeddingsResponse(inputCount)));
          } else if (url.includes('/models')) {
            res.statusCode = 200;
            res.end(JSON.stringify(getMockModelsResponse()));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        });
      });

      this.mockServer.listen(0, '127.0.0.1', () => {
        const addr = this.mockServer!.address();
        if (addr && typeof addr === 'object') {
          this.mockServerPort = addr.port;
          console.log(`Mock API server running at http://127.0.0.1:${this.mockServerPort}`);
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.mockServer.on('error', reject);
    });
  }
}

/**
 * Puppeteer PageHandle implementation
 */
class PuppeteerPageHandle implements PageHandle {
  constructor(private page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }

  async waitForSelector(selector: string, timeout = 5000): Promise<void> {
    await this.page.waitForSelector(selector, { timeout });
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.page.type(selector, text);
  }

  async select(selector: string, value: string): Promise<void> {
    await this.page.select(selector, value);
  }

  async $(selector: string): Promise<boolean> {
    const element = await this.page.$(selector);
    return element !== null;
  }

  async $eval<T>(selector: string, fn: string): Promise<T> {
    return await this.page.$eval(selector, new Function('el', `return (${fn})(el)`) as any);
  }

  async evaluate<T>(fn: string): Promise<T> {
    return await this.page.evaluate(fn);
  }

  async waitForFunction(fn: string, timeout = 30000): Promise<void> {
    await this.page.waitForFunction(fn, { timeout });
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
