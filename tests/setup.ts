import { beforeAll, afterAll, vi } from 'vitest';
import Dexie from 'dexie';
import  { IDBFactory, IDBDatabase, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBKeyRange, IDBRequest, IDBOpenDBRequest, IDBTransaction, IDBVersionChangeEvent } from 'fake-indexeddb';
import { setPlatformAdapter, type PlatformAdapter } from '../src/lib/platform';

// Set up fake-indexedDB globally BEFORE any imports that might use it
const idbFactory = new IDBFactory();
(globalThis as any).indexedDB = idbFactory;
(globalThis as any).IDBFactory = IDBFactory;
(globalThis as any).IDBDatabase = IDBDatabase;
(globalThis as any).IDBObjectStore = IDBObjectStore;
(globalThis as any).IDBIndex = IDBIndex;
(globalThis as any).IDBCursor = IDBCursor;
(globalThis as any).IDBCursorWithValue = IDBCursorWithValue;
(globalThis as any).IDBKeyRange = IDBKeyRange;
(globalThis as any).IDBRequest = IDBRequest;
(globalThis as any).IDBOpenDBRequest = IDBOpenDBRequest;
(globalThis as any).IDBTransaction = IDBTransaction;
(globalThis as any).IDBVersionChangeEvent = IDBVersionChangeEvent;

Dexie.dependencies.indexedDB = idbFactory;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    lastError: undefined,
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  },
} as any;

(globalThis as any).__IS_FIREFOX__ = false;
(globalThis as any).__IS_CHROME__ = true;
(globalThis as any).__IS_WEB__ = false;
(globalThis as any).__DEBUG_EMBEDDINGS__ = false;

// Set up mock platform adapter
const mockPlatformAdapter: PlatformAdapter = {
  getSettings: vi.fn().mockResolvedValue({
    apiKey: 'test-api-key',
    apiBaseUrl: 'https://api.test.com',
    chatModel: 'gpt-4',
    embeddingModel: 'text-embedding-3-small',
  }),
  saveSetting: vi.fn().mockResolvedValue(undefined),
  getTheme: vi.fn().mockResolvedValue('dark'),
  setTheme: vi.fn().mockResolvedValue(undefined),
};

setPlatformAdapter(mockPlatformAdapter);

// crypto.randomUUID is available natively in jsdom, no need to mock

beforeAll(() => {
  Dexie.delete('BookmarkRAG').catch(() => {});
});

afterAll(() => {
  Dexie.delete('BookmarkRAG').catch(() => {});
});
