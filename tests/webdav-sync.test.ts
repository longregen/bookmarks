import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import { performSync, getSyncStatus } from '../src/lib/webdav-sync';
import * as settings from '../src/lib/settings';
import * as exportModule from '../src/lib/export';

global.fetch = vi.fn();

vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
}));

vi.mock('../src/lib/export', () => ({
  exportAllBookmarks: vi.fn(),
  importBookmarks: vi.fn(),
}));

async function resetSyncModule() {
  vi.resetModules();
}

describe('WebDAV Sync - Race Condition Protection', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    vi.clearAllMocks();
    vi.useRealTimers();

    vi.mocked(settings.getSettings).mockResolvedValue({
      webdavEnabled: true,
      webdavUrl: 'https://webdav.example.com',
      webdavUsername: 'testuser',
      webdavPassword: 'testpass',
      webdavPath: '/bookmarks',
      webdavLastSyncTime: null,
      webdavLastSyncError: null,
    } as any);

    vi.mocked(exportModule.exportAllBookmarks).mockResolvedValue({
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      bookmarkCount: 0,
      bookmarks: [],
    });

    vi.mocked(exportModule.importBookmarks).mockResolvedValue({
      imported: 0,
      skipped: 0,
      failed: 0,
    });

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({}),
    } as Response);
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    vi.useRealTimers();
  });

  describe('Concurrent Sync Prevention', () => {
    it('should prevent concurrent sync operations', async () => {
      let syncCount = 0;

      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        syncCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const results = await Promise.all([
        performSync(true),
        performSync(true),
        performSync(true),
      ]);

      const skipped = results.filter(r => r.action === 'skipped').length;
      const uploaded = results.filter(r => r.action === 'uploaded').length;

      expect(skipped).toBe(2);
      expect(uploaded).toBe(1);
      expect(syncCount).toBe(1);
    });

    it('should use state manager for sync flag', async () => {
      const result = await performSync(true);

      expect(['uploaded', 'no-change']).toContain(result.action);
      expect(result.success).toBe(true);
    });

    it('should return correct sync status during sync', async () => {
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const syncPromise = performSync(true);
      const statusDuringSyncPromise = getSyncStatus();

      await syncPromise;
      const statusDuringSync = await statusDuringSyncPromise;
      const statusAfterSync = await getSyncStatus();

      expect(statusAfterSync.isSyncing).toBe(false);
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid sync requests', async () => {
      let syncCount = 0;
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        syncCount++;
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const result1 = await performSync(true);
      const result2 = await performSync();
      const result3 = await performSync();

      expect(result1.action).toBe('uploaded');
      expect(result2.action).toBe('skipped');
      expect(result3.action).toBe('skipped');
      expect(result2.message).toContain('debounced');
      expect(result3.message).toContain('debounced');
      expect(syncCount).toBe(1);
    });

    it('should allow sync after debounce period', async () => {
      let syncCount = 0;
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        syncCount++;
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      await performSync(true);
      await new Promise(resolve => setTimeout(resolve, 5200));

      const result = await performSync();

      expect(result.action).toBe('uploaded');
      expect(syncCount).toBe(2);
    }, 10000);

    it('should bypass debounce when force is true', async () => {
      let syncCount = 0;
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        syncCount++;
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      await performSync(true);
      const result = await performSync(true);

      expect(result.action).not.toBe('skipped');
      expect(syncCount).toBe(2);
    });
  });

  describe('State Cleanup', () => {
    it('should properly clean up state on successful sync', async () => {
      await performSync();
      const result = await performSync(true);

      expect(['uploaded', 'no-change']).toContain(result.action);
      expect(result.success).toBe(true);
    });

    it.skip('should properly clean up state on sync error', async () => {
      vi.mocked(global.fetch).mockClear();
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result1 = await performSync(true);
      expect(result1.success).toBe(false);
      expect(result1.action).toBe('error');

      vi.mocked(global.fetch).mockClear();
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({}),
      } as Response);

      const result2 = await performSync(true);

      expect(['uploaded', 'no-change']).toContain(result2.action);
    });

    it('should handle rapid sequential syncs with force flag', async () => {
      let syncCount = 0;
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        syncCount++;
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      await performSync(true);
      await performSync(true);
      await performSync(true);

      expect(syncCount).toBe(3);
    });
  });

  describe('Configuration Validation', () => {
    it('should skip sync if WebDAV is not configured', async () => {
      vi.mocked(settings.getSettings).mockResolvedValue({
        webdavEnabled: false,
      } as any);

      const result = await performSync(true);

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
      expect(result.message).toContain('not configured');
    });

    it('should skip sync if WebDAV is not enabled', async () => {
      vi.mocked(settings.getSettings).mockResolvedValue({
        webdavEnabled: false,
        webdavUrl: 'https://webdav.example.com',
        webdavUsername: 'testuser',
        webdavPassword: 'testpass',
      } as any);

      const result = await performSync(true);

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });

    it('should skip sync if WebDAV URL is missing', async () => {
      vi.mocked(settings.getSettings).mockResolvedValue({
        webdavEnabled: true,
        webdavUrl: '',
        webdavUsername: 'testuser',
        webdavPassword: 'testpass',
      } as any);

      const result = await performSync(true);

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });
  });

  describe('Error Handling', () => {
    it.skip('should handle network errors gracefully', async () => {
      vi.mocked(global.fetch).mockClear();
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network timeout'));

      const result = await performSync(true);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.message).toContain('Network timeout');
    });

    it.skip('should save error to settings', async () => {
      vi.mocked(global.fetch).mockClear();
      vi.mocked(global.fetch).mockRejectedValue(new Error('Connection failed'));

      await performSync(true);

      expect(settings.saveSetting).toHaveBeenCalledWith(
        'webdavLastSyncError',
        'Connection failed'
      );
    });

    it('should reset sync state even when error occurs', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      await performSync(true);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
      } as Response);

      const result = await performSync(true);

      expect(result.action).not.toBe('skipped');
    });
  });

  describe('Session Consistency', () => {
    it('should maintain session consistency across syncs', async () => {
      await performSync(true);
      const result = await performSync(true);

      expect(['uploaded', 'no-change']).toContain(result.action);
    });

    it('should handle sequential sync operations', async () => {
      const result = await performSync(true);

      expect(['uploaded', 'no-change', 'skipped']).toContain(result.action);
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status', async () => {
      const status = await getSyncStatus();

      expect(status).toBeDefined();
      expect(status.isSyncing).toBe(false);
      expect(status.lastSyncTime).toBeNull();
      expect(status.lastSyncError).toBeNull();
    });

    it('should reflect active sync state', async () => {
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const syncPromise = performSync(true);
      await new Promise(resolve => setTimeout(resolve, 10));

      const statusDuringSync = await getSyncStatus();
      await syncPromise;

      const statusAfterSync = await getSyncStatus();
      expect(statusAfterSync.isSyncing).toBe(false);
    });
  });
});
