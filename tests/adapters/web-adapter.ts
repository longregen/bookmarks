import puppeteer, { Browser, Page } from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import { TestAdapter, PageHandle } from '../e2e-shared';
import { startMockServer, getMockPageUrls, MockServer } from '../mock-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WebAdapter implements TestAdapter {
  platformName = 'Web App';
  isExtension = false;

  private browser: Browser | null = null;
  private mockServer: MockServer | null = null;
  private webServer: http.Server | null = null;
  private webServerPort: number = 0;

  private webDistPath: string;
  private browserPath: string;
  private apiKey: string;

  constructor() {
    this.webDistPath = path.resolve(__dirname, '../../dist-web');
    this.browserPath = process.env.BROWSER_PATH || '';
    this.apiKey = process.env.OPENAI_API_KEY || '';

    if (!this.browserPath) {
      throw new Error('BROWSER_PATH environment variable is required');
    }
    if (!this.apiKey) {
      console.warn('OPENAI_API_KEY not set - real API tests will be skipped');
    }
    if (!fs.existsSync(this.webDistPath)) {
      throw new Error(`Web dist path does not exist: ${this.webDistPath}. Run "npm run build:web" first.`);
    }
  }

  async setup(): Promise<void> {
    this.mockServer = await startMockServer();
    await this.startWebServer();

    this.browser = await puppeteer.launch({
      executablePath: this.browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  async teardown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }

    await Promise.all([
      this.mockServer ? this.mockServer.close() : Promise.resolve(),
      new Promise<void>(resolve => {
        if (this.webServer) this.webServer.close(() => resolve());
        else resolve();
      }),
    ]);
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
      popup: '/src/web/index.html', // Web app doesn't have popup
      index: '/src/web/index.html',
    };
    return `http://127.0.0.1:${this.webServerPort}${paths[pageName]}`;
  }

  getMockApiUrl(): string {
    return this.mockServer!.url;
  }

  getMockPageUrls(): string[] {
    return getMockPageUrls(this.mockServer!.url);
  }

  getRealApiKey(): string {
    return this.apiKey;
  }

  hasRealApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  private async startWebServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.webServer = http.createServer((req, res) => {
        let url = req.url || '/';

        if (url.startsWith('/webapp')) {
          url = url.slice('/webapp'.length) || '/';
        }

        if (url === '/' || url === '') {
          url = '/src/web/index.html';
        }

        const filePath = path.join(this.webDistPath, url);

        // Security check - prevent path traversal
        if (!filePath.startsWith(this.webDistPath)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        fs.readFile(filePath, (err, data) => {
          if (err) {
            if (err.code === 'ENOENT') {
              res.statusCode = 404;
              res.end('Not found');
            } else {
              res.statusCode = 500;
              res.end('Server error');
            }
            return;
          }

          const ext = path.extname(filePath).toLowerCase();
          const contentTypes: Record<string, string> = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
          };
          res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
          res.end(data);
        });
      });

      this.webServer.listen(0, '127.0.0.1', () => {
        const addr = this.webServer!.address();
        if (addr && typeof addr === 'object') {
          this.webServerPort = addr.port;
          console.log(`Web server running at http://127.0.0.1:${this.webServerPort}`);
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.webServer.on('error', reject);
    });
  }
}

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

  async screenshot(path: string, options?: { fullPage?: boolean }): Promise<void> {
    await this.page.screenshot({ path, fullPage: options?.fullPage });
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    const input = await this.page.$(selector);
    if (!input) {
      throw new Error(`File input not found: ${selector}`);
    }
    await input.uploadFile(filePath);
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
