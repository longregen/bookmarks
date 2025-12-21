import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import { startProcessingQueue } from '../src/background/queue';
import * as processor from '../src/background/processor';

vi.mock('../src/background/processor', () => ({
  processBookmarkContent: vi.fn(),
  fetchBookmarkHtml: vi.fn().mockImplementation(async (bookmark) => {
    // Simulate successful fetch by updating bookmark status to 'downloaded'
    await db.bookmarks.update(bookmark.id, {
      status: 'downloaded',
      updatedAt: new Date(),
    });
    return { ...bookmark, status: 'downloaded' };
  }),
}));

vi.mock('../src/lib/webdav-sync', () => ({
  triggerSyncIfEnabled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/jobs', () => ({
  updateJobItemByBookmark: vi.fn().mockResolvedValue(undefined),
  getJobItemByBookmark: vi.fn().mockResolvedValue(undefined),
  updateJobStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/config-registry', () => ({
  config: {
    QUEUE_MAX_RETRIES: 0, // Disable retries in tests for predictable behavior
    QUEUE_RETRY_BASE_DELAY_MS: 0,
    QUEUE_RETRY_MAX_DELAY_MS: 0,
    FETCH_CONCURRENCY: 5,
  },
}));

describe('Queue Management', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.jobItems.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.jobItems.clear();
  });

  describe('startProcessingQueue', () => {
    it('should process a pending bookmark', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-1',
          url: 'https://example.com',
        })
      );
    });

    it('should not process when queue is already running', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockImplementation(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      );

      const firstProcess = startProcessingQueue();
      await startProcessingQueue();
      await firstProcess;

      expect(processMock).toHaveBeenCalledTimes(1);
    });

    it('should process bookmarks with fetching status', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '',
        status: 'fetching' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const fetchMock = vi.spyOn(processor, 'fetchBookmarkHtml');
      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      // Fetch should be called for 'fetching' status bookmarks
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-1',
          status: 'fetching',
        })
      );

      // Content processing should be called after fetch completes
      expect(processMock).toHaveBeenCalled();
    });

    it('should mark bookmark as complete on success', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('complete');
    });

    it('should mark bookmark as error on failure', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      vi.spyOn(processor, 'processBookmarkContent').mockRejectedValue(new Error('Processing failed'));

      await startProcessingQueue();

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('error');
      // Error message includes retry context
      expect(updatedBookmark?.errorMessage).toContain('Processing failed');
    });

    it('should continue processing after error', async () => {
      const bookmark1 = {
        id: 'test-1',
        url: 'https://example.com/1',
        title: 'Test Page 1',
        html: '<html><body>Test 1</body></html>',
        status: 'pending' as const,
        createdAt: new Date(Date.now() - 2000),
        updatedAt: new Date(Date.now() - 2000),
      };

      const bookmark2 = {
        id: 'test-2',
        url: 'https://example.com/2',
        title: 'Test Page 2',
        html: '<html><body>Test 2</body></html>',
        status: 'pending' as const,
        createdAt: new Date(Date.now() - 1000),
        updatedAt: new Date(Date.now() - 1000),
      };

      await db.bookmarks.add(bookmark1);
      await db.bookmarks.add(bookmark2);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockImplementation(async (bookmark) => {
        if (bookmark.id === 'test-1') {
          throw new Error('Processing failed');
        }
      });

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledTimes(2);

      const bookmark1Updated = await db.bookmarks.get('test-1');
      const bookmark2Updated = await db.bookmarks.get('test-2');
      expect(bookmark1Updated?.status).toBe('error');
      expect(bookmark2Updated?.status).toBe('complete');
    });

    it('should handle empty queue', async () => {
      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).not.toHaveBeenCalled();
    });

    it('should trigger WebDAV sync when queue is empty', async () => {
      const { triggerSyncIfEnabled } = await import('../src/lib/webdav-sync');

      await startProcessingQueue();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(triggerSyncIfEnabled).toHaveBeenCalled();
    });

    it('should not process complete bookmarks', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'complete' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).not.toHaveBeenCalled();
    });

    it('should not process error bookmarks', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'error' as const,
        errorMessage: 'Previous error',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).not.toHaveBeenCalled();
    });

    it('should handle multiple pending bookmarks', async () => {
      const bookmarks = Array.from({ length: 5 }, (_, i) => ({
        id: `test-${i}`,
        url: `https://example.com/${i}`,
        title: `Test Page ${i}`,
        html: `<html><body>Test ${i}</body></html>`,
        status: 'pending' as const,
        createdAt: new Date(Date.now() - (5 - i) * 1000),
        updatedAt: new Date(Date.now() - (5 - i) * 1000),
      }));

      for (const bookmark of bookmarks) {
        await db.bookmarks.add(bookmark);
      }

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledTimes(5);
    });

    it('should reset isProcessing flag after completion', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const processMock = vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      const bookmark2 = {
        id: 'test-2',
        url: 'https://example.com/2',
        title: 'Test Page 2',
        html: '<html><body>Test 2</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark2);

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Race Condition Protection', () => {
    it('should prevent concurrent queue processing', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      let processCount = 0;
      vi.spyOn(processor, 'processBookmarkContent').mockImplementation(
        async () => {
          processCount++;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      );

      const promises = [
        startProcessingQueue(),
        startProcessingQueue(),
        startProcessingQueue(),
      ];

      await Promise.all(promises);

      expect(processCount).toBe(1);
    });
  });

  describe('Timeout Detection', () => {
    it('should reset stuck bookmarks to pending with incremented retry count', async () => {
      // Create a bookmark stuck in processing state with old updatedAt timestamp
      const oldTimestamp = new Date(Date.now() - 120000); // 2 minutes ago
      const bookmark = {
        id: 'test-stuck',
        url: 'https://example.com/stuck',
        title: 'Stuck Page',
        html: '<html><body>Test</body></html>',
        status: 'processing' as const,
        retryCount: 0,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      };

      await db.bookmarks.add(bookmark);

      const mockConfig = await import('../src/lib/config-registry');
      vi.mocked(mockConfig.config).QUEUE_PROCESSING_TIMEOUT_MS = 60000;
      vi.mocked(mockConfig.config).QUEUE_MAX_RETRIES = 3;

      vi.spyOn(processor, 'processBookmarkContent').mockResolvedValue(undefined);

      await startProcessingQueue();

      const updatedBookmark = await db.bookmarks.get('test-stuck');
      // Should be complete after being reset and processed, but with incremented retry count
      expect(updatedBookmark?.status).toBe('complete');
      expect(updatedBookmark?.retryCount).toBe(1);
    });

    it('should mark stuck bookmarks as error when max retries exceeded', async () => {
      // Create a bookmark stuck in processing with max retries already at limit
      const oldTimestamp = new Date(Date.now() - 120000);
      const bookmark = {
        id: 'test-stuck-max',
        url: 'https://example.com/stuck-max',
        title: 'Stuck Max Retries',
        html: '<html><body>Test</body></html>',
        status: 'processing' as const,
        retryCount: 3, // Already at max retries
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      };

      await db.bookmarks.add(bookmark);

      const mockConfig = await import('../src/lib/config-registry');
      vi.mocked(mockConfig.config).QUEUE_PROCESSING_TIMEOUT_MS = 60000;
      vi.mocked(mockConfig.config).QUEUE_MAX_RETRIES = 3;

      await startProcessingQueue();

      const updatedBookmark = await db.bookmarks.get('test-stuck-max');
      expect(updatedBookmark?.status).toBe('error');
      expect(updatedBookmark?.errorMessage).toContain('Timeout after');
    });

    it('should not reset recent processing bookmarks', async () => {
      // Create a bookmark in processing state with recent updatedAt
      const recentTimestamp = new Date(Date.now() - 5000); // 5 seconds ago
      const bookmark = {
        id: 'test-recent',
        url: 'https://example.com/recent',
        title: 'Recent Processing',
        html: '<html><body>Test</body></html>',
        status: 'processing' as const,
        retryCount: 0,
        createdAt: recentTimestamp,
        updatedAt: recentTimestamp,
      };

      await db.bookmarks.add(bookmark);

      const mockConfig = await import('../src/lib/config-registry');
      vi.mocked(mockConfig.config).QUEUE_PROCESSING_TIMEOUT_MS = 60000;

      await startProcessingQueue();

      const updatedBookmark = await db.bookmarks.get('test-recent');
      // Should still be in processing state because it's not older than timeout
      expect(updatedBookmark?.status).toBe('processing');
      expect(updatedBookmark?.retryCount).toBe(0);
    });
  });
});
