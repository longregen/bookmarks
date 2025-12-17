import { Builder, Browser, WebDriver, By, until, WebElement } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  TestAdapter,
  PageHandle,
  getMockQAPairsResponse,
  getMockEmbeddingsResponse,
  getMockModelsResponse,
} from '../e2e-shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class FirefoxAdapter implements TestAdapter {
  platformName = 'Firefox Extension';
  isExtension = true;

  private driver: WebDriver | null = null;
  private extensionUUID: string = '';
  private mockServer: http.Server | null = null;
  private mockServerPort: number = 0;
  private tempDir: string = '';
  private xpiPath: string = '';

  private extensionPath: string;
  private browserPath: string;
  private apiKey: string;

  constructor() {
    this.extensionPath = process.env.EXTENSION_PATH
      ? path.resolve(process.cwd(), process.env.EXTENSION_PATH)
      : path.resolve(__dirname, '../../dist-firefox');
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

    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firefox-e2e-'));
    this.xpiPath = path.join(this.tempDir, 'extension.xpi');
    this.createXpi();

    const options = new firefox.Options();
    options.setBinary(this.browserPath);

    this.driver = await new Builder()
      .forBrowser(Browser.FIREFOX)
      .setFirefoxOptions(options)
      .build();

    const firefoxDriver = this.driver as any;
    await firefoxDriver.installAddon(this.xpiPath, true);

    // Give Firefox time to load the extension
    await new Promise(resolve => setTimeout(resolve, 2000));

    this.extensionUUID = await this.detectExtensionUUID();
    console.log(`Extension UUID: ${this.extensionUUID}`);
  }

  async teardown(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
    }

    if (this.mockServer) {
      await new Promise<void>(resolve => {
        this.mockServer!.close(() => resolve());
      });
    }

    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
      }
    }
  }

  async newPage(): Promise<PageHandle> {
    // Selenium doesn't have true "pages" like Puppeteer, but we can work with windows/tabs
    return new SeleniumPageHandle(this.driver!);
  }

  getPageUrl(pageName: 'library' | 'search' | 'options' | 'stumble' | 'popup' | 'index' | 'jobs'): string {
    const paths: Record<string, string> = {
      library: '/src/library/library.html',
      search: '/src/search/search.html',
      options: '/src/options/options.html',
      stumble: '/src/stumble/stumble.html',
      jobs: '/src/jobs/jobs.html',
      popup: '/src/popup/popup.html',
      index: '/src/popup/popup.html', // Firefox extension uses popup as main entry
    };
    return `moz-extension://${this.extensionUUID}${paths[pageName]}`;
  }

  getMockApiUrl(): string {
    return `http://127.0.0.1:${this.mockServerPort}`;
  }

  getRealApiKey(): string {
    return this.apiKey;
  }

  private createXpi(): void {
    console.log(`Creating XPI package from ${this.extensionPath}...`);
    try {
      execSync(`cd "${this.extensionPath}" && zip -r "${this.xpiPath}" .`, {
        stdio: 'pipe'
      });
      console.log(`XPI created at: ${this.xpiPath}`);
    } catch (error) {
      throw new Error(`Failed to create XPI: ${error}`);
    }
  }

  private async detectExtensionUUID(): Promise<string> {
    await this.driver!.get('about:debugging#/runtime/this-firefox');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pageSource = await this.driver!.getPageSource();

    const uuidMatch = pageSource.match(/moz-extension:\/\/([a-f0-9-]{36})/i);
    if (uuidMatch) {
      return uuidMatch[1];
    }

    const internalMatch = pageSource.match(/"internalUUID"\s*:\s*"([a-f0-9-]{36})"/i);
    if (internalMatch) {
      return internalMatch[1];
    }

    throw new Error('Could not detect extension UUID');
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

class SeleniumPageHandle implements PageHandle {
  constructor(private driver: WebDriver) {}

  async goto(url: string): Promise<void> {
    await this.driver.get(url);
    await this.driver.wait(async () => {
      const readyState = await this.driver.executeScript('return document.readyState');
      return readyState === 'complete';
    }, 15000);
  }

  async waitForSelector(selector: string, timeout = 5000): Promise<void> {
    await this.driver.wait(until.elementLocated(By.css(selector)), timeout);
  }

  async click(selector: string): Promise<void> {
    const element = await this.driver.findElement(By.css(selector));
    await element.click();
  }

  async type(selector: string, text: string): Promise<void> {
    const element = await this.driver.findElement(By.css(selector));
    await element.clear();
    await element.sendKeys(text);
  }

  async select(selector: string, value: string): Promise<void> {
    const element = await this.driver.findElement(By.css(selector));
    await element.sendKeys(value);
  }

  async $(selector: string): Promise<boolean> {
    try {
      await this.driver.findElement(By.css(selector));
      return true;
    } catch {
      return false;
    }
  }

  async $eval<T>(selector: string, fn: string): Promise<T> {
    const element = await this.driver.findElement(By.css(selector));
    return await this.driver.executeScript(`return (${fn})(arguments[0])`, element) as T;
  }

  async evaluate<T>(fn: string): Promise<T> {
    return await this.driver.executeScript(`return (${fn})`) as T;
  }

  async waitForFunction(fn: string, timeout = 30000): Promise<void> {
    await this.driver.wait(async () => {
      return await this.driver.executeScript(`return (${fn})`);
    }, timeout);
  }

  async close(): Promise<void> {
    // In Selenium, we don't typically close individual "pages"
    // We could close tabs, but for simplicity we'll leave this as a no-op
    // since tests will cleanup via driver.quit()
  }
}
