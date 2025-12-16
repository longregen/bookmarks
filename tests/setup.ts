import { beforeAll, afterAll } from 'vitest';
import Dexie from 'dexie';
import 'fake-indexeddb/auto';

// Mock Chrome API for unit tests
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    lastError: undefined,
  },
} as any;

// Mock build-time constants
(globalThis as any).__IS_FIREFOX__ = false;
(globalThis as any).__IS_CHROME__ = true;
(globalThis as any).__IS_WEB__ = false;
(globalThis as any).__DEBUG_EMBEDDINGS__ = false;

// crypto.randomUUID is available natively in jsdom, no need to mock

// Set up Dexie for in-memory testing
beforeAll(() => {
  // Dexie uses indexedDB which is available in jsdom
  Dexie.delete('BookmarkRAG').catch(() => {});
});

afterAll(() => {
  // Clean up test database
  Dexie.delete('BookmarkRAG').catch(() => {});
});
