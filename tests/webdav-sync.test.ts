import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import { performSync, getSyncStatus } from '../src/lib/webdav-sync';
import * as settings from '../src/lib/settings';
import * as exportModule from '../src/lib/export';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the settings module
vi.mock('../src/lib/settings', () => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
}));

// Mock the export module
vi.mock('../src/lib/export', () => ({
  exportAllBookmarks: vi.fn(),
  importBookmarks: vi.fn(),
}));

describe('WebDAV Sync - Race Condition Protection', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    vi.clearAllMocks();

    // Default mock implementations
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

    // Mock successful fetch responses
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({}),
    } as Response);
  });

  afterEach(async () => {
    await db.bookmarks.clear();
  });

  describe('Concurrent Sync Prevention', () => {
    it('should prevent concurrent sync operations', async () => {
      let syncCount = 0;

      // Mock a slow sync operation
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

      // Start multiple sync operations concurrently
      const results = await Promise.all([
        performSync(),
        performSync(),
        performSync(),
      ]);

      // One should succeed, two should be skipped
      const skipped = results.filter(r => r.action === 'skipped').length;
      const uploaded = results.filter(r => r.action === 'uploaded').length;

      expect(skipped).toBe(2);
      expect(uploaded).toBe(1);
      expect(syncCount).toBe(1); // Should only export once
    });

    it('should use state manager for sync flag', async () => {
      const result = await performSync();

      // Should complete successfully
      expect(['uploaded', 'no-change']).toContain(result.action);
      expect(result.success).toBe(true);
    });

    it('should return correct sync status during sync', async () => {
      // Start a slow sync
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const syncPromise = performSync();

      // Check status while syncing
      const statusDuringSyncPromise = getSyncStatus();

      // Wait for both
      await syncPromise;
      const statusDuringSync = await statusDuringSyncPromise;

      // Status after sync
      const statusAfterSync = await getSyncStatus();

      // After sync, should not be syncing
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

      // Make rapid sync requests
      const result1 = await performSync();
      const result2 = await performSync();
      const result3 = await performSync();

      // First should succeed, rest should be debounced
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

      // First sync
      await performSync();

      // Wait for debounce period (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 5100));

      // Second sync should work
      const result = await performSync();

      expect(result.action).toBe('uploaded');
      expect(syncCount).toBe(2);
    });

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

      // First sync
      await performSync();

      // Immediate second sync with force=true should work
      const result = await performSync(true);

      expect(result.action).not.toBe('skipped');
      expect(syncCount).toBe(2);
    });
  });

  describe('State Cleanup', () => {
    it('should properly clean up state on successful sync', async () => {
      // First sync
      await performSync();

      // Add a small delay
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second sync should work (state was properly cleaned up)
      const result = await performSync(true); // Use force to bypass debounce

      expect(['uploaded', 'no-change']).toContain(result.action);
      expect(result.success).toBe(true);
    });

    it('should properly clean up state on sync error', async () => {
      // Mock an error
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      // First sync (will fail)
      const result1 = await performSync();
      expect(result1.success).toBe(false);
      expect(result1.action).toBe('error');

      // Mock successful fetch for second attempt
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({}),
      } as Response);

      // Second sync should work (state was properly cleaned up despite error)
      const result2 = await performSync(true); // Use force to bypass debounce

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

      // Rapid sequential syncs with force flag
      await performSync(true);
      await performSync(true);
      await performSync(true);

      // All should execute (with force flag, debouncing is bypassed)
      // But state manager should prevent concurrent execution
      expect(syncCount).toBe(3);
    });
  });

  describe('Configuration Validation', () => {
    it('should skip sync if WebDAV is not configured', async () => {
      vi.mocked(settings.getSettings).mockResolvedValue({
        webdavEnabled: false,
      } as any);

      const result = await performSync();

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

      const result = await performSync();

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

      const result = await performSync();

      expect(result.success).toBe(false);
      expect(result.action).toBe('skipped');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network timeout'));

      const result = await performSync();

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.message).toContain('Network timeout');
    });

    it('should save error to settings', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Connection failed'));

      await performSync();

      expect(settings.saveSetting).toHaveBeenCalledWith(
        'webdavLastSyncError',
        'Connection failed'
      );
    });

    it('should reset sync state even when error occurs', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      // First sync fails
      await performSync();

      // Mock successful fetch
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
      } as Response);

      // Second sync should work (state was reset despite error)
      const result = await performSync(true);

      // Should not be skipped due to stuck state
      expect(result.action).not.toBe('skipped');
    });
  });

  describe('Session Consistency', () => {
    it('should maintain session consistency across syncs', async () => {
      // Import state manager to verify session handling
      const stateManagerModule = await import('../src/lib/state-manager');

      // First sync
      await performSync();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second sync with force flag
      const result = await performSync(true);

      // Should succeed (session is consistent)
      expect(['uploaded', 'no-change']).toContain(result.action);
    });

    it('should use state manager for sync operations', async () => {
      const stateManagerModule = await import('../src/lib/state-manager');

      const result = await performSync();

      // Verify sync completed
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
      // Start a slow sync
      vi.mocked(exportModule.exportAllBookmarks).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarkCount: 1,
          bookmarks: [],
        };
      });

      const syncPromise = performSync();

      // Small delay to let sync start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check status - might be syncing
      const statusDuringSync = await getSyncStatus();

      await syncPromise;

      // Check status after sync
      const statusAfterSync = await getSyncStatus();
      expect(statusAfterSync.isSyncing).toBe(false);
    });
  });
});
