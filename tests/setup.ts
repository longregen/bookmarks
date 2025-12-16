import { beforeAll, afterAll, vi } from 'vitest';
import Dexie from 'dexie';
import  { IDBFactory, IDBDatabase, IDBObjectStore, IDBIndex, IDBCursor, IDBCursorWithValue, IDBKeyRange, IDBRequest, IDBOpenDBRequest, IDBTransaction, IDBVersionChangeEvent } from 'fake-indexeddb';

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

// Configure Dexie to use fake-indexedDB
Dexie.dependencies.indexedDB = idbFactory;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

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
