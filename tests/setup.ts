import { beforeAll, afterAll, vi } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// Mock Chrome API for unit tests
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    lastError: undefined,
  },
} as any;

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
