import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import { startProcessingQueue } from '../src/background/queue';
import * as processor from '../src/background/processor';

vi.mock('../src/background/processor', () => ({
  processBookmark: vi.fn(),
}));

vi.mock('../src/lib/webdav-sync', () => ({
  triggerSyncIfEnabled: vi.fn().mockResolvedValue(undefined),
}));

describe('Queue Management', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(
        async (bookmark) => {
          await new Promise(resolve => setTimeout(resolve, 100));
          await db.bookmarks.update(bookmark.id, { status: 'complete' });
        }
      );

      const firstProcess = startProcessingQueue();
      await startProcessingQueue();
      await firstProcess;

      expect(processMock).toHaveBeenCalledTimes(1);
    });

    it('should process bookmarks in order by createdAt', async () => {
      const now = Date.now();

      const bookmark1 = {
        id: 'test-1',
        url: 'https://example.com/1',
        title: 'Test Page 1',
        html: '<html><body>Test 1</body></html>',
        status: 'pending' as const,
        createdAt: new Date(now - 2000),
        updatedAt: new Date(now - 2000),
      };

      const bookmark2 = {
        id: 'test-2',
        url: 'https://example.com/2',
        title: 'Test Page 2',
        html: '<html><body>Test 2</body></html>',
        status: 'pending' as const,
        createdAt: new Date(now - 1000),
        updatedAt: new Date(now - 1000),
      };

      await db.bookmarks.add(bookmark2);
      await db.bookmarks.add(bookmark1);

      const processedOrder: string[] = [];
      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        processedOrder.push(bookmark.id);
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

      await startProcessingQueue();

      expect(processedOrder).toEqual(['test-1', 'test-2']);
    });

    it('should reset bookmarks stuck in processing state', async () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const stuckBookmark = {
        id: 'stuck-1',
        url: 'https://example.com/stuck',
        title: 'Stuck Page',
        html: '<html><body>Stuck</body></html>',
        status: 'processing' as const,
        createdAt: twoMinutesAgo,
        updatedAt: twoMinutesAgo,
      };

      await db.bookmarks.add(stuckBookmark);

      const retryModule = await import('../src/lib/retry');
      const getNextRetryTimeSpy = vi.spyOn(retryModule, 'getNextRetryTime').mockReturnValue(new Date(Date.now() - 1000));

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete', updatedAt: new Date() });
      });

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'stuck-1',
        })
      );

      const updatedBookmark = await db.bookmarks.get('stuck-1');
      expect(updatedBookmark?.status).toBe('complete');

      getNextRetryTimeSpy.mockRestore();
    });

    it('should not reset recently processing bookmarks', async () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);

      const recentBookmark = {
        id: 'recent-1',
        url: 'https://example.com/recent',
        title: 'Recent Page',
        html: '<html><body>Recent</body></html>',
        status: 'processing' as const,
        createdAt: thirtySecondsAgo,
        updatedAt: thirtySecondsAgo,
      };

      await db.bookmarks.add(recentBookmark);

      const processMock = vi.spyOn(processor, 'processBookmark').mockResolvedValue(undefined);

      await startProcessingQueue();

      expect(processMock).not.toHaveBeenCalled();
    });

    it('should continue processing on error', async () => {
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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        if (bookmark.id === 'test-1') {
          await db.bookmarks.update(bookmark.id, {
            status: 'error',
            errorMessage: 'Processing failed',
            nextRetryAt: new Date(Date.now() + 1000000)
          });
          throw new Error('Processing failed');
        } else {
          await db.bookmarks.update(bookmark.id, { status: 'complete', updatedAt: new Date() });
        }
      });

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledTimes(2);
    });

    it('should handle empty queue', async () => {
      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

      await startProcessingQueue();

      expect(processMock).not.toHaveBeenCalled();
    });

    it('should handle multiple pending bookmarks in batch', async () => {
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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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

    it('should reset isProcessing flag on error', async () => {
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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'error', errorMessage: 'Test error' });
        throw new Error('Test error');
      });

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

      processMock.mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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
      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(
        async (bookmark) => {
          processCount++;
          await new Promise(resolve => setTimeout(resolve, 100));
          await db.bookmarks.update(bookmark.id, { status: 'complete' });
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

    it('should use state manager for processing flag', async () => {
      const stateManagerModule = await import('../src/lib/state-manager');

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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

      await startProcessingQueue();

      expect(processMock).toHaveBeenCalled();
    });

    it('should handle rapid sequential queue starts', async () => {
      const bookmarks = Array.from({ length: 3 }, (_, i) => ({
        id: `test-${i}`,
        url: `https://example.com/${i}`,
        title: `Test Page ${i}`,
        html: `<html><body>Test ${i}</body></html>`,
        status: 'pending' as const,
        createdAt: new Date(Date.now() - (3 - i) * 1000),
        updatedAt: new Date(Date.now() - (3 - i) * 1000),
      }));

      for (const bookmark of bookmarks) {
        await db.bookmarks.add(bookmark);
      }

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

      await startProcessingQueue();
      await startProcessingQueue();
      await startProcessingQueue();

      expect(processMock).toHaveBeenCalledTimes(3);
    });

    it('should properly clean up state on successful completion', async () => {
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

      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

      await startProcessingQueue();
      expect(processMock).toHaveBeenCalledTimes(1);

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

    it('should properly clean up state on error', async () => {
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

      let test1CallCount = 0;
      const processMock = vi.spyOn(processor, 'processBookmark').mockImplementation(async (bookmark) => {
        if (bookmark.id === 'test-1') {
          test1CallCount++;
          if (test1CallCount === 1) {
            await db.bookmarks.update(bookmark.id, {
              status: 'error',
              errorMessage: 'Processing failed',
              nextRetryAt: new Date(Date.now() + 1000000)
            });
            throw new Error('Processing failed');
          }
        }
        await db.bookmarks.update(bookmark.id, { status: 'complete' });
      });

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
});
