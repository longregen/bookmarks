import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import {
  WebDAVSyncService,
  getSyncStatus,
  performSync,
  triggerSyncIfEnabled,
  resetSyncState,
  WebDAVConfigError,
  WebDAVNetworkError,
  WebDAVSyncError,
  WebDAVAuthError,
  type SyncResult,
} from '../effect/lib/webdav-sync';
import {
  SettingsService,
  type ApiSettings,
  SettingsError,
} from '../effect/lib/settings';
import {
  ExportStorageService,
  ExportJobService,
  exportAllBookmarks,
  importBookmarks,
  type BookmarkExport,
  type ImportResult,
} from '../effect/lib/export';
import {
  EventService,
  type EventData,
  type EventType,
  type EventPayloads,
} from '../effect/lib/events';
import { ConfigService } from '../effect/lib/config-registry';
import { UrlValidator } from '../effect/lib/url-validator';
import type { Bookmark, Markdown, QuestionAnswer } from '../effect/db/schema';

/**
 * Integration test for WebDAV Sync in Effect.ts refactored codebase
 *
 * Tests the full cooperation between:
 * - WebDAV sync service
 * - Settings management
 * - Export/Import operations
 * - Event broadcasting
 * - URL validation
 * - Conflict resolution
 */
describe('WebDAV Sync Integration Tests', () => {
  // Test state
  let bookmarksStore: Map<string, Bookmark>;
  let markdownStore: Map<string, Markdown>;
  let qaPairsStore: Map<string, QuestionAnswer[]>;
  let settingsStore: Map<string, string | boolean | number>;
  let eventLog: Array<{ type: EventType; payload: unknown }>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  // Mock WebDAV responses
  interface MockResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Map<string, string>;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }

  const createMockResponse = (partial: Partial<MockResponse>): MockResponse => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map(),
    json: async () => ({}),
    text: async () => '',
    ...partial,
  });

  // Mock Services
  const createMockSettingsService = () => ({
    getSettings: () =>
      Effect.sync(() => {
        const settings: ApiSettings = {
          apiKey: settingsStore.get('apiKey') as string || '',
          apiBaseUrl: settingsStore.get('apiBaseUrl') as string || '',
          chatModel: settingsStore.get('chatModel') as string || '',
          embeddingModel: settingsStore.get('embeddingModel') as string || '',
          webdavEnabled: settingsStore.get('webdavEnabled') as boolean || false,
          webdavUrl: settingsStore.get('webdavUrl') as string || '',
          webdavPath: settingsStore.get('webdavPath') as string || '/bookmarks',
          webdavUsername: settingsStore.get('webdavUsername') as string || '',
          webdavPassword: settingsStore.get('webdavPassword') as string || '',
          webdavAllowInsecure: settingsStore.get('webdavAllowInsecure') as boolean || false,
          webdavLastSyncTime: settingsStore.get('webdavLastSyncTime') as string || '',
          webdavLastSyncError: settingsStore.get('webdavLastSyncError') as string || '',
        };
        return settings;
      }),
    saveSetting: (key: keyof ApiSettings, value: string | boolean | number) =>
      Effect.sync(() => {
        settingsStore.set(key, value);
      }),
  });

  const createMockExportStorageService = () => ({
    getBookmark: (id: string) =>
      Effect.sync(() => bookmarksStore.get(id) ?? null),
    addBookmark: (bookmark: Bookmark) =>
      Effect.sync(() => {
        bookmarksStore.set(bookmark.id, bookmark);
      }),
    getAllBookmarks: () =>
      Effect.sync(() => Array.from(bookmarksStore.values())),
    getBookmarksArray: () =>
      Effect.sync(() => Array.from(bookmarksStore.values())),
    getMarkdown: (bookmarkId: string) =>
      Effect.sync(() => markdownStore.get(bookmarkId)),
    addMarkdown: (markdown: Markdown) =>
      Effect.sync(() => {
        markdownStore.set(markdown.bookmarkId, markdown);
      }),
    getMarkdownByBookmarkIds: (bookmarkIds: string[]) =>
      Effect.sync(() =>
        bookmarkIds
          .map((id) => markdownStore.get(id))
          .filter((m): m is Markdown => m !== undefined)
      ),
    getQAPairs: (bookmarkId: string) =>
      Effect.sync(() => qaPairsStore.get(bookmarkId) ?? []),
    bulkAddQAPairs: (qaPairs: QuestionAnswer[]) =>
      Effect.sync(() => {
        qaPairs.forEach((qa) => {
          const existing = qaPairsStore.get(qa.bookmarkId) ?? [];
          existing.push(qa);
          qaPairsStore.set(qa.bookmarkId, existing);
        });
      }),
    getQAPairsByBookmarkIds: (bookmarkIds: string[]) =>
      Effect.sync(() => {
        const allPairs: QuestionAnswer[] = [];
        bookmarkIds.forEach((id) => {
          const pairs = qaPairsStore.get(id) ?? [];
          allPairs.push(...pairs);
        });
        return allPairs;
      }),
  });

  const createMockJobService = () => ({
    createJob: () => Effect.void,
  });

  const createMockEventService = () => ({
    broadcastEvent: <T extends EventType>(type: T, payload: EventPayloads[T]) =>
      Effect.sync(() => {
        eventLog.push({ type, payload });
      }),
    addEventListener: () => Effect.void,
  });

  const createMockConfigService = () => {
    const getValue = (key: string) => {
      if (key === 'WEBDAV_SYNC_DEBOUNCE_MS') return Effect.succeed(5000);
      if (key === 'WEBDAV_SYNC_TIMEOUT_MS') return Effect.succeed(120000);
      return Effect.succeed(0);
    };

    return {
      loadOverrides: Effect.void,
      saveOverrides: Effect.void,
      getValue,
      get: getValue, // Alias for getValue
      setValue: () => Effect.void,
      resetValue: () => Effect.void,
      resetAll: Effect.void,
      isModified: () => Effect.succeed(false),
      getAllEntries: Effect.succeed([]),
      searchEntries: () => Effect.succeed([]),
      getModifiedCount: Effect.succeed(0),
      ensureLoaded: Effect.void,
    };
  };

  const createMockUrlValidator = () => ({
    validateUrl: () =>
      Effect.succeed({
        valid: true,
        normalizedUrl: 'https://webdav.example.com/bookmarks',
      }),
    validateWebDAVUrl: (url: string, allowInsecure = false) =>
      Effect.sync(() => {
        if (!url) {
          return { valid: false, error: 'WebDAV URL is not configured' };
        }
        if (!allowInsecure && url.startsWith('http:')) {
          return {
            valid: false,
            error: 'HTTP connections are not allowed for security reasons. Please use HTTPS or enable "Allow insecure connections" in settings.'
          };
        }
        return { valid: true, normalizedUrl: url };
      }),
    validateWebUrl: () =>
      Effect.succeed({ valid: true }),
  });

  // Helper to create a complete test layer
  const createTestLayer = () => {
    const settingsLayer = Layer.succeed(SettingsService, createMockSettingsService());
    const storageLayer = Layer.succeed(ExportStorageService, createMockExportStorageService());
    const jobLayer = Layer.succeed(ExportJobService, createMockJobService());
    const eventLayer = Layer.succeed(EventService, createMockEventService());
    const configLayer = Layer.succeed(ConfigService, createMockConfigService());
    const validatorLayer = Layer.succeed(UrlValidator, createMockUrlValidator());

    return Layer.mergeAll(
      settingsLayer,
      storageLayer,
      jobLayer,
      eventLayer,
      configLayer,
      validatorLayer
    );
  };

  beforeEach(() => {
    // Reset stores
    bookmarksStore = new Map();
    markdownStore = new Map();
    qaPairsStore = new Map();
    settingsStore = new Map();
    eventLog = [];

    // Reset sync state
    resetSyncState();

    // Set default WebDAV settings
    settingsStore.set('webdavEnabled', true);
    settingsStore.set('webdavUrl', 'https://webdav.example.com');
    settingsStore.set('webdavPath', '/bookmarks');
    settingsStore.set('webdavUsername', 'test-user');
    settingsStore.set('webdavPassword', 'test-password');
    settingsStore.set('webdavAllowInsecure', false);

    // Mock fetch
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Sync Status Tests
  // ==========================================================================

  describe('getSyncStatus', () => {
    it('should return current sync status from settings', async () => {
      settingsStore.set('webdavLastSyncTime', '2024-01-15T10:00:00Z');
      settingsStore.set('webdavLastSyncError', '');

      const testLayer = createTestLayer();
      const program = getSyncStatus();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.lastSyncTime).toBe('2024-01-15T10:00:00Z');
      expect(result.lastSyncError).toBe(null);
      expect(result.isSyncing).toBe(false);
    });

    it('should return sync error when present', async () => {
      settingsStore.set('webdavLastSyncTime', '2024-01-15T10:00:00Z');
      settingsStore.set('webdavLastSyncError', 'Network timeout');

      const testLayer = createTestLayer();
      const program = getSyncStatus();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.lastSyncError).toBe('Network timeout');
    });
  });

  // ==========================================================================
  // WebDAV Configuration Tests
  // ==========================================================================

  describe('WebDAV Configuration', () => {
    it('should skip sync when WebDAV is not configured', async () => {
      settingsStore.set('webdavEnabled', false);

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
      expect(result.message).toContain('not configured');
    });

    it('should skip sync when credentials are missing', async () => {
      settingsStore.set('webdavUsername', '');

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });

    it('should fail sync when URL validation fails (insecure HTTP)', async () => {
      settingsStore.set('webdavUrl', 'http://webdav.example.com');
      settingsStore.set('webdavAllowInsecure', false);

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.message).toContain('HTTP connections are not allowed');
    });

    it('should allow insecure HTTP when explicitly enabled', async () => {
      settingsStore.set('webdavUrl', 'http://webdav.example.com');
      settingsStore.set('webdavAllowInsecure', true);

      // Mock successful sync
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('PROPFIND')) {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (url.includes('bookmarks.json')) {
          return Promise.resolve(createMockResponse({
            status: 404,
            ok: false,
          }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      // Should not fail on validation
      expect(result.message).not.toContain('HTTP connections are not allowed');
    });
  });

  // ==========================================================================
  // Upload Sync Tests (Local → Remote)
  // ==========================================================================

  describe('Upload Sync', () => {
    it('should upload local bookmarks when remote file does not exist', async () => {
      // Add local bookmarks
      const bookmark1: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test Bookmark 1',
        html: '<html>Test 1</html>',
        status: 'complete',
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-10'),
      };
      const bookmark2: Bookmark = {
        id: 'bm-2',
        url: 'https://example.com/2',
        title: 'Test Bookmark 2',
        html: '<html>Test 2</html>',
        status: 'complete',
        createdAt: new Date('2024-01-11'),
        updatedAt: new Date('2024-01-11'),
      };
      bookmarksStore.set('bm-1', bookmark1);
      bookmarksStore.set('bm-2', bookmark2);

      // Mock WebDAV responses
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        // PROPFIND - folder check
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        // HEAD - file doesn't exist
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        // PUT - upload
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 201 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.action).toBe('uploaded');
      expect(result.bookmarkCount).toBe(2);
      expect(result.message).toContain('Uploaded 2 bookmarks');

      // Check sync:started and sync:completed events
      expect(eventLog.some(e => e.type === 'sync:started')).toBe(true);
      expect(eventLog.some(e => e.type === 'sync:completed')).toBe(true);

      // Check settings were updated
      expect(settingsStore.get('webdavLastSyncError')).toBe('');
      expect(settingsStore.get('webdavLastSyncTime')).toBeTruthy();
    });

    it('should upload bookmarks with Q&A pairs and markdown', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/article',
        title: 'Article',
        html: '<html>Content</html>',
        status: 'complete',
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-10'),
      };
      const markdown: Markdown = {
        id: 'md-1',
        bookmarkId: 'bm-1',
        content: '# Article\n\nContent here',
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-10'),
      };
      const qaPairs: QuestionAnswer[] = [
        {
          id: 'qa-1',
          bookmarkId: 'bm-1',
          question: 'What is this about?',
          answer: 'An article',
          embeddingQuestion: [0.1, 0.2, 0.3],
          embeddingAnswer: [0.4, 0.5, 0.6],
          embeddingBoth: [0.7, 0.8, 0.9],
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-10'),
        },
      ];

      bookmarksStore.set('bm-1', bookmark);
      markdownStore.set('bm-1', markdown);
      qaPairsStore.set('bm-1', qaPairs);

      let uploadedData: BookmarkExport | null = null;

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          uploadedData = JSON.parse(options.body as string) as BookmarkExport;
          return Promise.resolve(createMockResponse({ status: 201 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      expect(uploadedData).toBeTruthy();
      expect(uploadedData!.bookmarks).toHaveLength(1);
      expect(uploadedData!.bookmarks[0].markdown).toBe('# Article\n\nContent here');
      expect(uploadedData!.bookmarks[0].questionsAnswers).toHaveLength(1);
      expect(uploadedData!.bookmarks[0].questionsAnswers[0].question).toBe('What is this about?');
    });

    it('should skip upload when there are no local bookmarks', async () => {
      // No bookmarks in store

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.action).toBe('no-change');
      expect(result.message).toContain('No bookmarks to sync');
    });
  });

  // ==========================================================================
  // Download Sync Tests (Remote → Local)
  // ==========================================================================

  describe('Download Sync', () => {
    it('should download and merge remote bookmarks when remote is newer', async () => {
      // Add old local bookmark
      const localBookmark: Bookmark = {
        id: 'bm-local',
        url: 'https://example.com/local',
        title: 'Local Bookmark',
        html: '<html>Local</html>',
        status: 'complete',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      bookmarksStore.set('bm-local', localBookmark);

      // Remote data with newer timestamp
      const remoteData: BookmarkExport = {
        version: 2,
        exportedAt: new Date('2024-01-15').toISOString(),
        bookmarkCount: 2,
        bookmarks: [
          {
            id: 'bm-remote-1',
            url: 'https://example.com/remote1',
            title: 'Remote Bookmark 1',
            html: '<html>Remote 1</html>',
            status: 'complete',
            createdAt: new Date('2024-01-10').toISOString(),
            updatedAt: new Date('2024-01-10').toISOString(),
            questionsAnswers: [],
          },
          {
            id: 'bm-remote-2',
            url: 'https://example.com/remote2',
            title: 'Remote Bookmark 2',
            html: '<html>Remote 2</html>',
            status: 'complete',
            createdAt: new Date('2024-01-12').toISOString(),
            updatedAt: new Date('2024-01-12').toISOString(),
            questionsAnswers: [],
          },
        ],
      };

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          const headers = new Map([
            ['Last-Modified', 'Mon, 15 Jan 2024 10:00:00 GMT'],
            ['ETag', '"abc123"'],
          ]);
          return Promise.resolve(createMockResponse({
            status: 200,
            headers,
          }));
        }
        if (options?.method === 'GET') {
          return Promise.resolve(createMockResponse({
            status: 200,
            json: async () => remoteData,
          }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.action).toBe('downloaded');
      expect(result.message).toContain('Imported');

      // Check that remote bookmarks were imported
      expect(bookmarksStore.size).toBeGreaterThan(1);
    });

    it('should skip duplicates when downloading', async () => {
      // Add local bookmark with same URL as remote
      const localBookmark: Bookmark = {
        id: 'bm-local',
        url: 'https://example.com/duplicate',
        title: 'Local Bookmark',
        html: '<html>Local</html>',
        status: 'complete',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      bookmarksStore.set('bm-local', localBookmark);

      // Remote data with same URL
      const remoteData: BookmarkExport = {
        version: 2,
        exportedAt: new Date('2024-01-15').toISOString(),
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'bm-remote',
            url: 'https://example.com/duplicate', // Same URL!
            title: 'Remote Bookmark',
            html: '<html>Remote</html>',
            status: 'complete',
            createdAt: new Date('2024-01-10').toISOString(),
            updatedAt: new Date('2024-01-10').toISOString(),
            questionsAnswers: [],
          },
        ],
      };

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        if (options?.method === 'GET') {
          return Promise.resolve(createMockResponse({
            status: 200,
            json: async () => remoteData,
          }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.message).toContain('duplicates');

      // Should still only have 1 bookmark (duplicate skipped)
      expect(bookmarksStore.size).toBe(1);
    });
  });

  // ==========================================================================
  // Conflict Resolution Tests
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should upload when local data is newer than remote', async () => {
      // Add recent local bookmark
      const localBookmark: Bookmark = {
        id: 'bm-local',
        url: 'https://example.com/local',
        title: 'Local Bookmark',
        html: '<html>Local</html>',
        status: 'complete',
        createdAt: new Date('2024-01-20'),
        updatedAt: new Date('2024-01-20'),
      };
      bookmarksStore.set('bm-local', localBookmark);

      // Remote data with older timestamp
      const remoteData: BookmarkExport = {
        version: 2,
        exportedAt: new Date('2024-01-10').toISOString(), // Older!
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'bm-remote',
            url: 'https://example.com/remote',
            title: 'Remote Bookmark',
            html: '<html>Remote</html>',
            status: 'complete',
            createdAt: new Date('2024-01-05').toISOString(),
            updatedAt: new Date('2024-01-05').toISOString(),
            questionsAnswers: [],
          },
        ],
      };

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        if (options?.method === 'GET') {
          return Promise.resolve(createMockResponse({
            status: 200,
            json: async () => remoteData,
          }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.action).toBe('uploaded');
      expect(result.message).toContain('Uploaded');
    });

    it('should download and merge when remote is newer, then upload merged data', async () => {
      const localBookmark: Bookmark = {
        id: 'bm-local',
        url: 'https://example.com/local',
        title: 'Local Only',
        html: '<html>Local</html>',
        status: 'complete',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      bookmarksStore.set('bm-local', localBookmark);

      const remoteData: BookmarkExport = {
        version: 2,
        exportedAt: new Date('2024-01-15').toISOString(),
        bookmarkCount: 1,
        bookmarks: [
          {
            id: 'bm-remote',
            url: 'https://example.com/remote',
            title: 'Remote Only',
            html: '<html>Remote</html>',
            status: 'complete',
            createdAt: new Date('2024-01-10').toISOString(),
            updatedAt: new Date('2024-01-10').toISOString(),
            questionsAnswers: [],
          },
        ],
      };

      let uploadCalls = 0;

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        if (options?.method === 'GET') {
          return Promise.resolve(createMockResponse({
            status: 200,
            json: async () => remoteData,
          }));
        }
        if (options?.method === 'PUT') {
          uploadCalls++;
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      // Should have imported remote and uploaded merged data
      expect(uploadCalls).toBeGreaterThan(0);
      expect(bookmarksStore.size).toBe(2); // Both local and remote
    });
  });

  // ==========================================================================
  // Event Emission Tests
  // ==========================================================================

  describe('Event Emission', () => {
    it('should emit sync:started event at beginning of sync', async () => {
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      const startedEvent = eventLog.find(e => e.type === 'sync:started');
      expect(startedEvent).toBeTruthy();
      expect((startedEvent!.payload as any).manual).toBe(false);
    });

    it('should emit sync:started with manual=true for forced sync', async () => {
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync(true); // force=true

      await Effect.runPromise(Effect.provide(program, testLayer));

      const startedEvent = eventLog.find(e => e.type === 'sync:started');
      expect(startedEvent).toBeTruthy();
      expect((startedEvent!.payload as any).manual).toBe(true);
    });

    it('should emit sync:completed on successful sync', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      const completedEvent = eventLog.find(e => e.type === 'sync:completed');
      expect(completedEvent).toBeTruthy();
      expect((completedEvent!.payload as any).action).toBe('uploaded');
      expect((completedEvent!.payload as any).bookmarkCount).toBe(1);
    });

    it('should emit sync:failed on error', async () => {
      fetchMock.mockImplementation(() => {
        throw new Error('Network failure');
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      const failedEvent = eventLog.find(e => e.type === 'sync:failed');
      expect(failedEvent).toBeTruthy();
      expect((failedEvent!.payload as any).error).toContain('Network failure');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('Network timeout'));

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.message).toContain('Network timeout');

      // Error should be saved to settings
      expect(settingsStore.get('webdavLastSyncError')).toContain('Network timeout');
    });

    it('should handle 401 authentication errors', async () => {
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        return Promise.resolve(createMockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: async () => 'Invalid credentials',
        }));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(settingsStore.get('webdavLastSyncError')).toBeTruthy();
    });

    it('should handle 403 forbidden errors', async () => {
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        return Promise.resolve(createMockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: async () => 'Access denied',
        }));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
    });

    it('should handle 404 not found for file (initiates upload)', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 201 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(result.action).toBe('uploaded');
    });

    it('should handle 500 server errors', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(createMockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error',
        }))
      );

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
    });

    it('should clear error on successful sync', async () => {
      // Set initial error
      settingsStore.set('webdavLastSyncError', 'Previous error');

      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      const result = await Effect.runPromise(Effect.provide(program, testLayer));

      expect(result.success).toBe(true);
      expect(settingsStore.get('webdavLastSyncError')).toBe('');
    });
  });

  // ==========================================================================
  // WebDAV Protocol Tests
  // ==========================================================================

  describe('WebDAV Protocol', () => {
    it('should send correct Authorization header', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      let authHeader = '';

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.headers) {
          authHeader = (options.headers as Record<string, string>)['Authorization'] || '';
        }

        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      expect(authHeader).toContain('Basic');
      // Basic auth is base64(username:password)
      const expectedAuth = btoa('test-user:test-password');
      expect(authHeader).toBe(`Basic ${expectedAuth}`);
    });

    it('should create folder structure with MKCOL when needed', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      let mkcolCalled = false;

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          // Folder doesn't exist
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'MKCOL') {
          mkcolCalled = true;
          return Promise.resolve(createMockResponse({ status: 201 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 201 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      expect(mkcolCalled).toBe(true);
    });

    it('should use correct file path from settings', async () => {
      settingsStore.set('webdavPath', '/custom/path');

      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      let requestedUrl = '';

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        requestedUrl = url;

        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = performSync();

      await Effect.runPromise(Effect.provide(program, testLayer));

      expect(requestedUrl).toContain('/custom/path/bookmarks.json');
    });
  });

  // ==========================================================================
  // Debounce Tests
  // ==========================================================================

  describe('Sync Debouncing', () => {
    it('should debounce frequent sync attempts', async () => {
      const testLayer = createTestLayer();

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      // First sync
      const program1 = performSync();
      const result1 = await Effect.runPromise(Effect.provide(program1, testLayer));

      // Immediate second sync (should be debounced)
      const program2 = performSync();
      const result2 = await Effect.runPromise(Effect.provide(program2, testLayer));

      // First sync should complete
      expect(result1.action).not.toBe('skipped');

      // Second sync should be skipped due to debounce
      expect(result2.action).toBe('skipped');
      expect(result2.message).toContain('debounced');
    });

    it('should allow forced sync to bypass debounce', async () => {
      const testLayer = createTestLayer();

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      // First sync
      const program1 = performSync();
      await Effect.runPromise(Effect.provide(program1, testLayer));

      // Forced second sync (should NOT be debounced)
      const program2 = performSync(true); // force=true
      const result2 = await Effect.runPromise(Effect.provide(program2, testLayer));

      expect(result2.action).not.toBe('skipped');
    });
  });

  // ==========================================================================
  // triggerSyncIfEnabled Tests
  // ==========================================================================

  describe('triggerSyncIfEnabled', () => {
    it('should trigger sync when WebDAV is configured', async () => {
      const bookmark: Bookmark = {
        id: 'bm-1',
        url: 'https://example.com/1',
        title: 'Test',
        html: '<html>Test</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bookmarksStore.set('bm-1', bookmark);

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === 'PROPFIND') {
          return Promise.resolve(createMockResponse({ status: 207 }));
        }
        if (options?.method === 'HEAD') {
          return Promise.resolve(createMockResponse({ status: 404, ok: false }));
        }
        if (options?.method === 'PUT') {
          return Promise.resolve(createMockResponse({ status: 200 }));
        }
        return Promise.resolve(createMockResponse({}));
      });

      const testLayer = createTestLayer();
      const program = triggerSyncIfEnabled();

      await Effect.runPromise(Effect.provide(program, testLayer));

      // Should have triggered a sync
      const completedEvent = eventLog.find(e => e.type === 'sync:completed');
      expect(completedEvent).toBeTruthy();
    });

    it('should not trigger sync when WebDAV is disabled', async () => {
      settingsStore.set('webdavEnabled', false);

      const testLayer = createTestLayer();
      const program = triggerSyncIfEnabled();

      await Effect.runPromise(Effect.provide(program, testLayer));

      // Should not have triggered any events
      expect(eventLog.length).toBe(0);
    });
  });
});
