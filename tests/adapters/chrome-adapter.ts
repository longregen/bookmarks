import puppeteer, { Browser, Page, CoverageEntry } from 'puppeteer-core';
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

const COLLECT_COVERAGE = process.env.E2E_COVERAGE === 'true';

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

  private collectedCoverage: CoverageEntry[] = [];
  private activePagesForCoverage: Set<Page> = new Set();

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
    await this.startMockServer();

    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-profile-'));

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

    if (this.userDataDir && fs.existsSync(this.userDataDir)) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
      }
    }
  }

  async newPage(): Promise<PageHandle> {
    const page = await this.browser!.newPage();

    if (COLLECT_COVERAGE) {
      try {
        await page.coverage.startJSCoverage({
          resetOnNavigation: false,
          includeRawScriptCoverage: true,
        });
        this.activePagesForCoverage.add(page);
      } catch (error) {
        console.warn('[Coverage] Failed to start coverage for page:', error);
      }
    }

    return new PuppeteerPageHandle(page, this);
  }

  async collectPageCoverage(page: Page): Promise<void> {
    if (!COLLECT_COVERAGE || !this.activePagesForCoverage.has(page)) {
      return;
    }

    try {
      const coverage = await page.coverage.stopJSCoverage();
      const extensionCoverage = coverage.filter(entry => {
        return entry.url.includes('chrome-extension://') ||
               entry.url.includes('/src/');
      });
      this.collectedCoverage.push(...extensionCoverage);
      this.activePagesForCoverage.delete(page);
    } catch (error) {
      console.warn('[Coverage] Failed to collect coverage from page:', error);
    }
  }

  async startCoverage(): Promise<void> {
    if (COLLECT_COVERAGE) {
      console.log('[Coverage] E2E coverage collection enabled');
      this.collectedCoverage = [];
    }
  }

  async stopCoverage(): Promise<void> {
    if (!COLLECT_COVERAGE) return;

    for (const page of this.activePagesForCoverage) {
      try {
        const coverage = await page.coverage.stopJSCoverage();
        const extensionCoverage = coverage.filter(entry => {
          return entry.url.includes('chrome-extension://') ||
                 entry.url.includes('/src/');
        });
        this.collectedCoverage.push(...extensionCoverage);
      } catch {
      }
    }
    this.activePagesForCoverage.clear();

    console.log(`[Coverage] Collected ${this.collectedCoverage.length} coverage entries`);
  }

  async writeCoverage(): Promise<void> {
    if (!COLLECT_COVERAGE || this.collectedCoverage.length === 0) {
      return;
    }

    const coverageDir = path.resolve(__dirname, '../../coverage-e2e');
    if (!fs.existsSync(coverageDir)) {
      fs.mkdirSync(coverageDir, { recursive: true });
    }

    const v8CoveragePath = path.join(coverageDir, 'v8-coverage.json');
    fs.writeFileSync(v8CoveragePath, JSON.stringify(this.collectedCoverage, null, 2));
    console.log(`[Coverage] Raw V8 coverage written to: ${v8CoveragePath}`);

    try {
      await this.convertToIstanbul(coverageDir);
    } catch (error) {
      console.warn('[Coverage] Could not convert to Istanbul format:', error);
    }
  }

  private async convertToIstanbul(coverageDir: string): Promise<void> {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);

    let libCoverage;
    let v8ToIstanbul;

    try {
      libCoverage = require('istanbul-lib-coverage');
      v8ToIstanbul = require('v8-to-istanbul');
    } catch {
      console.log('[Coverage] Istanbul packages not available for conversion');
      return;
    }

    const coverageMap = libCoverage.createCoverageMap({});

    for (const entry of this.collectedCoverage) {
      if (!entry.text || !entry.url) continue;

      try {
        let filePath: string | null = null;

        if (entry.url.includes('chrome-extension://')) {
          const urlPath = entry.url.replace(/chrome-extension:\/\/[^/]+/, '');
          filePath = path.join(this.extensionPath, urlPath);
        }

        if (!filePath || !fs.existsSync(filePath)) {
          continue;
        }

        const converter = v8ToIstanbul(filePath, 0, { source: entry.text });
        await converter.load();
        converter.applyCoverage(entry.functions || []);

        const istanbulCoverage = converter.toIstanbul();
        for (const coverage of Object.values(istanbulCoverage)) {
          coverageMap.merge(libCoverage.createCoverageMap({ [(coverage as any).path]: coverage }));
        }
      } catch {
      }
    }

    const coveragePath = path.join(coverageDir, 'coverage-final.json');
    fs.writeFileSync(coveragePath, JSON.stringify(coverageMap.toJSON(), null, 2));
    console.log(`[Coverage] Istanbul coverage written to: ${coveragePath}`);
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
    }

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
              } catch { }
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

class PuppeteerPageHandle implements PageHandle {
  constructor(
    private page: Page,
    private adapter: ChromeAdapter
  ) {}

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

  async screenshot(path: string, options?: { fullPage?: boolean }): Promise<void> {
    await this.page.screenshot({ path, fullPage: options?.fullPage });
  }

  async close(): Promise<void> {
    await this.adapter.collectPageCoverage(this.page);
    await this.page.close();
  }
}
