import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import { processBulkFetch } from '../src/background/fetcher';
import * as browserFetch from '../src/lib/browser-fetch';
import * as queue from '../src/background/queue';

vi.mock('../src/lib/browser-fetch', () => ({
  browserFetch: vi.fn(),
}));

vi.mock('../src/background/queue', () => ({
  startProcessingQueue: vi.fn(),
}));

describe('Background Fetcher', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
  });

  describe('processBulkFetch', () => {
    it('should process all pending child jobs', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 2, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob1 = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const childJob2 = {
        id: 'child-2',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/2' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob1);
      await db.jobs.add(childJob2);

      vi.spyOn(browserFetch, 'browserFetch')
        .mockResolvedValueOnce('<html><title>Page 1</title></html>')
        .mockResolvedValueOnce('<html><title>Page 2</title></html>');

      await processBulkFetch('parent-1');

      expect(browserFetch.browserFetch).toHaveBeenCalledTimes(2);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(2);

      const updatedParent = await db.jobs.get('parent-1');
      expect(updatedParent?.status).toBe(JobStatus.COMPLETED);
    });

    it('should create bookmarks with fetched HTML', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      const htmlContent = '<html><title>Test Page</title><body>Content</body></html>';
      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue(htmlContent);

      await processBulkFetch('parent-1');

      const bookmark = await db.bookmarks.where('url').equals('https://example.com').first();
      expect(bookmark).toBeDefined();
      expect(bookmark?.html).toBe(htmlContent);
      expect(bookmark?.status).toBe('pending');
    });

    it('should update existing bookmarks instead of creating duplicates', async () => {
      const existingBookmark = {
        id: 'existing-1',
        url: 'https://example.com',
        title: 'Old Title',
        html: '<html><title>Old</title></html>',
        status: 'complete' as const,
        createdAt: new Date(Date.now() - 1000),
        updatedAt: new Date(Date.now() - 1000),
      };

      await db.bookmarks.add(existingBookmark);

      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      const newHtmlContent = '<html><title>New Title</title><body>New Content</body></html>';
      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue(newHtmlContent);

      await processBulkFetch('parent-1');

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(1);

      const bookmark = await db.bookmarks.get('existing-1');
      expect(bookmark?.html).toBe(newHtmlContent);
      expect(bookmark?.title).toBe('New Title');
      expect(bookmark?.status).toBe('pending');
    });

    it('should respect concurrency limit', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 10, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      for (let i = 0; i < 10; i++) {
        await db.jobs.add({
          id: `child-${i}`,
          type: JobType.URL_FETCH,
          status: JobStatus.PENDING,
          parentJobId: 'parent-1',
          progress: 0,
          metadata: { url: `https://example.com/${i}` },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const fetchMock = vi.spyOn(browserFetch, 'browserFetch').mockImplementation(async (url) => {
        return `<html><title>${url}</title></html>`;
      });

      await processBulkFetch('parent-1');

      expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it('should handle fetch failures gracefully', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 2, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob1 = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const childJob2 = {
        id: 'child-2',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/2' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob1);
      await db.jobs.add(childJob2);

      vi.spyOn(browserFetch, 'browserFetch')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('<html><title>Page 2</title></html>');

      await processBulkFetch('parent-1');

      const failedJob = await db.jobs.get('child-1');
      expect(failedJob?.status).toBe(JobStatus.FAILED);

      const successJob = await db.jobs.get('child-2');
      expect(successJob?.status).toBe(JobStatus.COMPLETED);

      const updatedParent = await db.jobs.get('parent-1');
      expect(updatedParent?.status).toBe(JobStatus.COMPLETED);
    });

    it('should skip already completed jobs', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 2, successCount: 1, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const completedJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: 'parent-1',
        progress: 100,
        metadata: { url: 'https://example.com/1' },
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      };

      const pendingJob = {
        id: 'child-2',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/2' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(completedJob);
      await db.jobs.add(pendingJob);

      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue('<html><title>Page 2</title></html>');

      await processBulkFetch('parent-1');

      expect(browserFetch.browserFetch).toHaveBeenCalledTimes(1);
      expect(browserFetch.browserFetch).toHaveBeenCalledWith('https://example.com/2', 30000);
    });

    it('should support job resumption', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 50,
        metadata: { totalUrls: 2, successCount: 1, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const completedJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: 'parent-1',
        progress: 100,
        metadata: { url: 'https://example.com/1' },
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      };

      const pendingJob = {
        id: 'child-2',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/2' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(completedJob);
      await db.jobs.add(pendingJob);

      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue('<html><title>Page 2</title></html>');

      await processBulkFetch('parent-1', true);

      expect(browserFetch.browserFetch).toHaveBeenCalledTimes(1);
    });

    it('should trigger queue processing after completion', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue('<html><title>Test</title></html>');
      const queueMock = vi.spyOn(queue, 'startProcessingQueue');

      await processBulkFetch('parent-1');

      expect(queueMock).toHaveBeenCalled();
    });

    it('should handle missing parent job', async () => {
      await expect(processBulkFetch('non-existent-parent')).resolves.not.toThrow();
    });

    it('should handle empty pending jobs list', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 0, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      await processBulkFetch('parent-1');

      const updatedParent = await db.jobs.get('parent-1');
      expect(updatedParent?.status).toBe(JobStatus.COMPLETED);
    });

    it('should update parent job metadata with resumption info', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue('<html><title>Test</title></html>');

      await processBulkFetch('parent-1', true);

      const updatedParent = await db.jobs.get('parent-1');
      expect(updatedParent?.metadata.resumedAt).toBeDefined();
    });

    it('should extract title from HTML when creating bookmark', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      const htmlContent = '<html><head><title>Extracted Title</title></head><body>Content</body></html>';
      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue(htmlContent);

      await processBulkFetch('parent-1');

      const bookmark = await db.bookmarks.where('url').equals('https://example.com').first();
      expect(bookmark?.title).toBe('Extracted Title');
    });

    it('should use URL as title if no title in HTML', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com/page' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      const htmlContent = '<html><body>No title</body></html>';
      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue(htmlContent);

      await processBulkFetch('parent-1');

      const bookmark = await db.bookmarks.where('url').equals('https://example.com/page').first();
      expect(bookmark?.title).toBe('https://example.com/page');
    });

    it('should link completed job to bookmark', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      vi.spyOn(browserFetch, 'browserFetch').mockResolvedValue('<html><title>Test</title></html>');

      await processBulkFetch('parent-1');

      const completedJob = await db.jobs.get('child-1');
      expect(completedJob?.bookmarkId).toBeDefined();

      const bookmark = await db.bookmarks.get(completedJob!.bookmarkId!);
      expect(bookmark).toBeDefined();
    });

    it('should handle timeout during fetch', async () => {
      const parentJob = {
        id: 'parent-1',
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.IN_PROGRESS,
        progress: 0,
        metadata: { totalUrls: 1, successCount: 0, failureCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(parentJob);

      const childJob = {
        id: 'child-1',
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: 'parent-1',
        progress: 0,
        metadata: { url: 'https://slow-example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.jobs.add(childJob);

      vi.spyOn(browserFetch, 'browserFetch').mockRejectedValue(new Error('Timeout'));

      await processBulkFetch('parent-1');

      const failedJob = await db.jobs.get('child-1');
      expect(failedJob?.status).toBe(JobStatus.FAILED);
      expect(failedJob?.metadata.errorMessage).toBe('Timeout');
    });
  });
});
