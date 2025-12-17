import { Builder, Browser, WebDriver, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { TestAdapter, PageHandle } from '../e2e-shared';
import { startMockServer, MockServer } from '../mock-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class FirefoxAdapter implements TestAdapter {
  platformName = 'Firefox Extension';
  isExtension = true;

  private driver: WebDriver | null = null;
  private extensionUUID: string = '';
  private mockServer: MockServer | null = null;
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
      console.warn('OPENAI_API_KEY not set - real API tests will be skipped');
    }
    if (!fs.existsSync(this.extensionPath)) {
      throw new Error(`Extension path does not exist: ${this.extensionPath}`);
    }
  }

  async setup(): Promise<void> {
    this.mockServer = await startMockServer();

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
      await this.mockServer.close();
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
    return this.mockServer!.url;
  }

  getRealApiKey(): string {
    return this.apiKey;
  }

  hasRealApiKey(): boolean {
    return this.apiKey.length > 0;
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
