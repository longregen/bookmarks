import puppeteer, { Browser, Page } from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestAdapter, PageHandle } from '../e2e-shared';
import { startMockServer, getMockPageUrls, MockServer } from '../mock-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

export class WebAdapter implements TestAdapter {
  platformName = 'Web App';
  isExtension = false;

  private browser: Browser | null = null;
  private mockServer: MockServer | null = null;
  private staticServer: http.Server | null = null;
  private staticPort = 0;
  private distPath: string;
  private browserPath: string;

  constructor() {
    this.distPath = path.resolve(__dirname, '../../dist-web');
    this.browserPath = process.env.BROWSER_PATH || '';

    if (!this.browserPath) {
      throw new Error('BROWSER_PATH environment variable is required');
    }
    if (!fs.existsSync(this.distPath)) {
      throw new Error(`dist-web does not exist: ${this.distPath}. Run npm run build:web first.`);
    }
  }

  async setup(): Promise<void> {
    this.mockServer = await startMockServer();

    await new Promise<void>((resolve, reject) => {
      this.staticServer = http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];

        // Strip the /webapp/ prefix to get the file path within dist-web
        const prefix = '/webapp/';
        let filePath: string;
        if (urlPath.startsWith(prefix)) {
          filePath = path.join(this.distPath, urlPath.slice(prefix.length));
        } else {
          filePath = path.join(this.distPath, urlPath);
        }

        // Default to index.html for directory requests
        if (filePath.endsWith('/') || !path.extname(filePath)) {
          filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.statusCode = 200;
        fs.createReadStream(filePath).pipe(res);
      });

      this.staticServer.listen(0, '127.0.0.1', () => {
        const addr = this.staticServer!.address();
        if (addr && typeof addr === 'object') {
          this.staticPort = addr.port;
          console.log(`Static server serving dist-web at http://127.0.0.1:${this.staticPort}/webapp/`);
          resolve();
        } else {
          reject(new Error('Failed to get static server address'));
        }
      });

      this.staticServer.on('error', reject);
    });

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
    if (this.mockServer) {
      await this.mockServer.close();
    }
    if (this.staticServer) {
      await new Promise<void>(resolve => this.staticServer!.close(() => resolve()));
    }
  }

  async newPage(): Promise<PageHandle> {
    const page = await this.browser!.newPage();

    page.on('console', async (msg) => {
      const type = msg.type();
      const args = msg.args();
      const textParts: string[] = [];
      for (const arg of args) {
        try {
          const val = await arg.jsonValue();
          textParts.push(typeof val === 'object' ? JSON.stringify(val) : String(val));
        } catch {
          textParts.push(msg.text());
          break;
        }
      }
      const text = textParts.join(' ');
      if (type === 'error') {
        console.error(`[Browser] ${text}`);
      } else if (type === 'warning') {
        console.warn(`[Browser] ${text}`);
      } else {
        console.log(`[Browser] ${text}`);
      }
    });

    page.on('pageerror', (error) => {
      console.error(`[Browser Error] ${error.message}\n${error.stack}`);
    });

    await page.setViewport({ width: 1280, height: 800 });

    return new WebPuppeteerPageHandle(page);
  }

  getPageUrl(pageName: 'library' | 'search' | 'options' | 'stumble' | 'popup' | 'index' | 'jobs' | 'status' | 'view'): string {
    const base = `http://127.0.0.1:${this.staticPort}/webapp`;
    const paths: Record<string, string> = {
      library: '/src/library/library.html',
      search: '/src/search/search.html',
      options: '/src/options/options.html',
      stumble: '/src/stumble/stumble.html',
      jobs: '/src/jobs/jobs.html',
      status: '/src/status/status.html',
      view: '/src/view/view.html',
      popup: '/src/options/options.html', // Web has no popup
      index: '/src/web/index.html',       // Connect page
    };
    return `${base}${paths[pageName]}`;
  }

  getMockApiUrl(): string {
    return this.mockServer!.url;
  }

  getMockPageUrls(): string[] {
    return getMockPageUrls(this.mockServer!.url);
  }

  getRealApiKey(): string {
    return '';
  }

  hasRealApiKey(): boolean {
    return false;
  }
}

class WebPuppeteerPageHandle implements PageHandle {
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

  async screenshot(filePath: string, options?: { fullPage?: boolean }): Promise<void> {
    await this.page.screenshot({ path: filePath, fullPage: options?.fullPage });
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
