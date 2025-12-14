import { beforeAll, afterAll } from 'vitest';
import Dexie from 'dexie';

// Mock Chrome API for unit tests
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    lastError: undefined,
  },
} as any;

// Mock crypto.randomUUID
global.crypto = {
  randomUUID: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
} as any;

// Set up Dexie for in-memory testing
beforeAll(() => {
  // Dexie uses indexedDB which is available in jsdom
  Dexie.delete('BookmarkRAG').catch(() => {});
});

afterAll(() => {
  // Clean up test database
  Dexie.delete('BookmarkRAG').catch(() => {});
});
