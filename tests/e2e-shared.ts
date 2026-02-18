import { CONFIG_REGISTRY } from '../src/lib/config-registry';

export interface CDPSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, callback: (params: unknown) => void): void;
  off(event: string, callback: (params: unknown) => void): void;
  detach(): Promise<void>;
}

export interface PageHandle {
  goto(url: string): Promise<void>;
  waitForSelector(selector: string, timeout?: number): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  $(selector: string): Promise<boolean>;
  $eval<T>(selector: string, fn: string): Promise<T>;
  evaluate<T>(fn: string): Promise<T>;
  waitForFunction(fn: string, timeout?: number): Promise<void>;
  screenshot(path: string, options?: { fullPage?: boolean }): Promise<void>;
  uploadFile(selector: string, filePath: string): Promise<void>;
  close(): Promise<void>;
  createCDPSession?(): Promise<CDPSession>;
}

export interface TestAdapter {
  platformName: string;
  isExtension: boolean;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  newPage(): Promise<PageHandle>;
  getPageUrl(page: 'library' | 'search' | 'options' | 'stumble' | 'popup' | 'index' | 'jobs' | 'status' | 'view'): string;
  getMockApiUrl(): string;
  getMockPageUrls(): string[];
  getRealApiKey(): string;
  hasRealApiKey(): boolean;
  startCoverage?(): Promise<void>;
  stopCoverage?(): Promise<void>;
  writeCoverage?(): Promise<void>;
}

export function generateMockEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

export function getMockQAPairsResponse(): object {
  return {
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
            { question: 'What is this page about?', answer: 'This is a test page for E2E testing.' },
            { question: 'What is the main topic?', answer: 'The main topic is testing browser extensions.' },
            { question: 'Who is this content for?', answer: 'This content is for developers testing their browser extensions.' },
          ]
        })
      },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  };
}

export function getMockEmbeddingsResponse(inputCount: number): object {
  return {
    object: 'list',
    data: Array.from({ length: inputCount }, (_, i) => ({
      object: 'embedding',
      index: i,
      embedding: generateMockEmbedding()
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: inputCount * 10, total_tokens: inputCount * 10 }
  };
}

export function getMockModelsResponse(): object {
  return {
    object: 'list',
    data: [
      { id: 'gpt-4o-mini', object: 'model' },
      { id: 'text-embedding-3-small', object: 'model' }
    ]
  };
}

const FETCH_OFFSCREEN_BUFFER_MS = CONFIG_REGISTRY.find(e => e.key === 'FETCH_OFFSCREEN_BUFFER_MS')!.defaultValue as number;

export async function waitForSettingsLoad(page: PageHandle): Promise<void> {
  await page.waitForFunction(
    `document.getElementById('apiBaseUrl')?.value?.length > 0`,
    FETCH_OFFSCREEN_BUFFER_MS
  );
}
