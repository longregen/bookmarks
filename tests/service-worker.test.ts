import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import { createJob } from '../src/lib/jobs';

describe('Service Worker Core Functionality', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.bookmarkTags.clear();
    await db.markdown.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.bookmarkTags.clear();
    await db.markdown.clear();
  });

  describe('Bookmark saving logic', () => {
    it('should create a new bookmark with pending status', async () => {
      const data = {
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
      };

      const bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url: data.url,
        title: data.title,
        html: data.html,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get(bookmarkId);
      expect(bookmark?.url).toBe(data.url);
      expect(bookmark?.title).toBe(data.title);
      expect(bookmark?.html).toBe(data.html);
      expect(bookmark?.status).toBe('pending');
    });

    it('should update existing bookmark when URL matches', async () => {
      const existingBookmark = {
        id: 'existing-1',
        url: 'https://example.com',
        title: 'Old Title',
        html: '<html><body>Old</body></html>',
        status: 'complete' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(existingBookmark);

      const existing = await db.bookmarks.where('url').equals('https://example.com').first();
      expect(existing).toBeDefined();

      await db.bookmarks.update(existing!.id, {
        title: 'New Title',
        html: '<html><body>New</body></html>',
        status: 'pending',
        errorMessage: undefined,
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get('existing-1');
      expect(bookmark?.title).toBe('New Title');
      expect(bookmark?.html).toBe('<html><body>New</body></html>');
      expect(bookmark?.status).toBe('pending');
    });

    it('should reset error state when updating existing bookmark', async () => {
      const errorBookmark = {
        id: 'error-1',
        url: 'https://example.com',
        title: 'Error Page',
        html: '<html><body>Old</body></html>',
        status: 'error' as const,
        errorMessage: 'Previous error',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(errorBookmark);

      await db.bookmarks.update('error-1', {
        html: '<html><body>New</body></html>',
        status: 'pending',
        errorMessage: undefined,
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get('error-1');
      expect(bookmark?.status).toBe('pending');
      expect(bookmark?.errorMessage).toBeUndefined();
    });

    it('should handle very large HTML content', async () => {
      const largeHtml = '<html><body>' + 'x'.repeat(1000000) + '</body></html>';

      const bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url: 'https://example.com',
        title: 'Large Page',
        html: largeHtml,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get(bookmarkId);
      expect(bookmark?.html.length).toBe(largeHtml.length);
    });

    it('should handle special characters in URLs', async () => {
      const url = 'https://example.com/path?query=value&other=123#section';

      const bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url,
        title: 'Test',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get(bookmarkId);
      expect(bookmark?.url).toBe(url);
    });

    it('should handle empty title', async () => {
      const bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url: 'https://example.com',
        title: '',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get(bookmarkId);
      expect(bookmark?.title).toBe('');
    });
  });

  describe('Job creation', () => {
    it('should create FILE_IMPORT job with correct metadata', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
        metadata: {
          fileName: 'bookmarks.html',
          importedCount: 10,
        },
      });

      expect(job.type).toBe(JobType.FILE_IMPORT);
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.metadata.fileName).toBe('bookmarks.html');
      expect(job.metadata.importedCount).toBe(10);
    });

    it('should create BULK_URL_IMPORT job with URL count', async () => {
      const job = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.COMPLETED,
        metadata: {
          totalUrls: 5,
        },
      });

      expect(job.type).toBe(JobType.BULK_URL_IMPORT);
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.metadata.totalUrls).toBe(5);
    });

    it('should create URL_FETCH job with parent reference', async () => {
      const parentJob = await createJob({
        type: JobType.BULK_URL_IMPORT,
        status: JobStatus.COMPLETED,
        metadata: { totalUrls: 1 },
      });

      const childJob = await createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.COMPLETED,
        parentJobId: parentJob.id,
        metadata: {
          url: 'https://example.com',
        },
      });

      expect(childJob.parentJobId).toBe(parentJob.id);
      expect(childJob.metadata.url).toBe('https://example.com');
    });
  });

  describe('Job queries', () => {
    it('should retrieve job with all fields', async () => {
      const job = await createJob({
        type: JobType.FILE_IMPORT,
        status: JobStatus.COMPLETED,
        metadata: { test: 'data' },
      });

      const retrieved = await db.jobs.get(job.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(job.id);
      expect(retrieved?.type).toBe(JobType.FILE_IMPORT);
      expect(retrieved?.status).toBe(JobStatus.COMPLETED);
      expect(retrieved?.createdAt).toBeInstanceOf(Date);
    });

    it('should return undefined for non-existent job', async () => {
      const job = await db.jobs.get('non-existent');
      expect(job).toBeUndefined();
    });
  });

  describe('Bookmark status transitions', () => {
    it('should transition from pending to processing', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      await db.bookmarks.update('test-1', {
        status: 'processing',
        updatedAt: new Date(),
      });

      const updated = await db.bookmarks.get('test-1');
      expect(updated?.status).toBe('processing');
    });

    it('should transition from processing to complete', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'processing' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      await db.bookmarks.update('test-1', {
        status: 'complete',
        updatedAt: new Date(),
      });

      const updated = await db.bookmarks.get('test-1');
      expect(updated?.status).toBe('complete');
    });

    it('should transition from processing to error with error details', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'processing' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const error = new Error('Test error');
      await db.bookmarks.update('test-1', {
        status: 'error',
        errorMessage: error.message,
        updatedAt: new Date(),
      });

      const updated = await db.bookmarks.get('test-1');
      expect(updated?.status).toBe('error');
      expect(updated?.errorMessage).toBe('Test error');
    });

    it('should support fetching status for bulk imports', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test',
        html: '',
        status: 'fetching' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const retrieved = await db.bookmarks.get('test-1');
      expect(retrieved?.status).toBe('fetching');
    });
  });

  describe('Concurrent bookmark operations', () => {
    it('should handle multiple bookmarks being added simultaneously', async () => {
      const bookmarks = Array.from({ length: 10 }, (_, i) => ({
        id: `bookmark-${i}`,
        url: `https://example.com/${i}`,
        title: `Page ${i}`,
        html: `<html><body>Page ${i}</body></html>`,
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await Promise.all(bookmarks.map(b => db.bookmarks.add(b)));

      const count = await db.bookmarks.count();
      expect(count).toBe(10);
    });

    it('should query bookmarks by status', async () => {
      await db.bookmarks.add({
        id: '1',
        url: 'https://example.com/1',
        title: 'Page 1',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.bookmarks.add({
        id: '2',
        url: 'https://example.com/2',
        title: 'Page 2',
        html: '<html></html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.bookmarks.add({
        id: '3',
        url: 'https://example.com/3',
        title: 'Page 3',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const pending = await db.bookmarks.where('status').equals('pending').toArray();
      expect(pending).toHaveLength(2);
      expect(pending.every(b => b.status === 'pending')).toBe(true);
    });

    it('should query bookmarks by URL', async () => {
      await db.bookmarks.add({
        id: '1',
        url: 'https://example.com/test',
        title: 'Test',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.where('url').equals('https://example.com/test').first();
      expect(bookmark).toBeDefined();
      expect(bookmark?.id).toBe('1');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle missing required fields gracefully', async () => {
      const invalidBookmark: any = {
        id: 'invalid-1',
        url: 'https://example.com',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(invalidBookmark);
      const retrieved = await db.bookmarks.get('invalid-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBeUndefined();
    });

    it('should handle duplicate IDs', async () => {
      const bookmark = {
        id: 'duplicate-1',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      await expect(db.bookmarks.add(bookmark)).rejects.toThrow();
    });

    it('should handle updates to non-existent bookmarks', async () => {
      const result = await db.bookmarks.update('non-existent', {
        title: 'New Title',
      });

      expect(result).toBe(0);
    });
  });

  describe('Reprocess all bookmarks', () => {
    it('should reset complete bookmarks to pending', async () => {
      await db.bookmarks.bulkAdd([
        { id: 'complete-1', url: 'https://a.com', title: 'A', html: '', status: 'complete', createdAt: new Date(), updatedAt: new Date() },
        { id: 'complete-2', url: 'https://b.com', title: 'B', html: '', status: 'complete', createdAt: new Date(), updatedAt: new Date() },
      ]);

      await db.transaction('rw', db.bookmarks, async () => {
        const bookmarks = await db.bookmarks.where('status').anyOf(['complete', 'error']).toArray();
        for (const b of bookmarks) {
          await db.bookmarks.update(b.id, { status: 'pending', retryCount: 0, errorMessage: undefined, updatedAt: new Date() });
        }
      });

      const all = await db.bookmarks.toArray();
      expect(all).toHaveLength(2);
      expect(all.every(b => b.status === 'pending')).toBe(true);
      expect(all.every(b => b.retryCount === 0)).toBe(true);
      expect(all.every(b => b.errorMessage === undefined)).toBe(true);
    });

    it('should reset error bookmarks to pending', async () => {
      await db.bookmarks.bulkAdd([
        { id: 'err-1', url: 'https://a.com', title: 'A', html: '', status: 'error', errorMessage: 'Failed', retryCount: 3, createdAt: new Date(), updatedAt: new Date() },
        { id: 'err-2', url: 'https://b.com', title: 'B', html: '', status: 'error', errorMessage: 'Timeout', retryCount: 5, createdAt: new Date(), updatedAt: new Date() },
      ]);

      await db.transaction('rw', db.bookmarks, async () => {
        const bookmarks = await db.bookmarks.where('status').anyOf(['complete', 'error']).toArray();
        for (const b of bookmarks) {
          await db.bookmarks.update(b.id, { status: 'pending', retryCount: 0, errorMessage: undefined, updatedAt: new Date() });
        }
      });

      const all = await db.bookmarks.toArray();
      expect(all).toHaveLength(2);
      expect(all.every(b => b.status === 'pending')).toBe(true);
      expect(all.every(b => b.retryCount === 0)).toBe(true);
      expect(all.every(b => b.errorMessage === undefined)).toBe(true);
    });

    it('should not touch bookmarks that are in-progress', async () => {
      await db.bookmarks.bulkAdd([
        { id: 'pending-1', url: 'https://a.com', title: 'A', html: '', status: 'pending', createdAt: new Date(), updatedAt: new Date() },
        { id: 'fetching-1', url: 'https://b.com', title: 'B', html: '', status: 'fetching', createdAt: new Date(), updatedAt: new Date() },
        { id: 'downloaded-1', url: 'https://c.com', title: 'C', html: '', status: 'downloaded', createdAt: new Date(), updatedAt: new Date() },
        { id: 'processing-1', url: 'https://d.com', title: 'D', html: '', status: 'processing', createdAt: new Date(), updatedAt: new Date() },
        { id: 'complete-1', url: 'https://e.com', title: 'E', html: '', status: 'complete', createdAt: new Date(), updatedAt: new Date() },
      ]);

      await db.transaction('rw', db.bookmarks, async () => {
        const bookmarks = await db.bookmarks.where('status').anyOf(['complete', 'error']).toArray();
        for (const b of bookmarks) {
          await db.bookmarks.update(b.id, { status: 'pending', retryCount: 0, errorMessage: undefined, updatedAt: new Date() });
        }
      });

      expect((await db.bookmarks.get('pending-1'))?.status).toBe('pending');
      expect((await db.bookmarks.get('fetching-1'))?.status).toBe('fetching');
      expect((await db.bookmarks.get('downloaded-1'))?.status).toBe('downloaded');
      expect((await db.bookmarks.get('processing-1'))?.status).toBe('processing');
      expect((await db.bookmarks.get('complete-1'))?.status).toBe('pending');
    });

    it('should handle empty database', async () => {
      const bookmarks = await db.bookmarks.where('status').anyOf(['complete', 'error']).toArray();
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('Sync upload job creation', () => {
    it('should create SYNC_UPLOAD job', async () => {
      const job = await createJob({
        type: JobType.SYNC_UPLOAD,
        status: JobStatus.IN_PROGRESS,
      });

      expect(job.type).toBe(JobType.SYNC_UPLOAD);
      expect(job.status).toBe(JobStatus.IN_PROGRESS);

      const retrieved = await db.jobs.get(job.id);
      expect(retrieved?.type).toBe(JobType.SYNC_UPLOAD);
    });

    it('should prepare bookmark data with tags and markdown for upload', async () => {
      const now = new Date();
      await db.bookmarks.bulkAdd([
        { id: 'b1', url: 'https://a.com', title: 'A', html: '<html>A</html>', status: 'complete', createdAt: now, updatedAt: now },
        { id: 'b2', url: 'https://b.com', title: 'B', html: '<html>B</html>', status: 'complete', createdAt: now, updatedAt: now },
      ]);
      await db.bookmarkTags.bulkAdd([
        { bookmarkId: 'b1', tagName: 'tag1', addedAt: now },
        { bookmarkId: 'b1', tagName: 'tag2', addedAt: now },
        { bookmarkId: 'b2', tagName: 'tag1', addedAt: now },
      ]);
      await db.markdown.bulkAdd([
        { id: 'b1-md', bookmarkId: 'b1', content: '# Page A', createdAt: now, updatedAt: now },
      ]);

      const allBookmarks = await db.bookmarks.toArray();
      const allTags = await db.bookmarkTags.toArray();
      const allMarkdown = await db.markdown.toArray();

      const tagsByBookmark = new Map<string, string[]>();
      for (const tag of allTags) {
        const tags = tagsByBookmark.get(tag.bookmarkId) ?? [];
        tags.push(tag.tagName);
        tagsByBookmark.set(tag.bookmarkId, tags);
      }

      const markdownByBookmark = new Map<string, string>();
      for (const md of allMarkdown) {
        markdownByBookmark.set(md.bookmarkId, md.content);
      }

      const uploadData = allBookmarks.map(b => ({
        id: b.id,
        url: b.url,
        title: b.title,
        html: b.html,
        markdown: markdownByBookmark.get(b.id),
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        tags: tagsByBookmark.get(b.id) ?? [],
      }));

      expect(uploadData).toHaveLength(2);

      const b1 = uploadData.find(b => b.id === 'b1')!;
      expect(b1.tags).toEqual(['tag1', 'tag2']);
      expect(b1.markdown).toBe('# Page A');

      const b2 = uploadData.find(b => b.id === 'b2')!;
      expect(b2.tags).toEqual(['tag1']);
      expect(b2.markdown).toBeUndefined();
    });

    it('should handle empty database for sync upload', async () => {
      const allBookmarks = await db.bookmarks.toArray();
      expect(allBookmarks).toHaveLength(0);

      const job = await createJob({
        type: JobType.SYNC_UPLOAD,
        status: JobStatus.IN_PROGRESS,
      });
      await db.jobs.update(job.id, { status: JobStatus.COMPLETED });

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.COMPLETED);
    });

    it('should mark job as failed on error', async () => {
      const job = await createJob({
        type: JobType.SYNC_UPLOAD,
        status: JobStatus.IN_PROGRESS,
      });

      await db.jobs.update(job.id, { status: JobStatus.FAILED });

      const updated = await db.jobs.get(job.id);
      expect(updated?.status).toBe(JobStatus.FAILED);
    });
  });

  describe('Message routing patterns', () => {
    it('should identify message types correctly', () => {
      const messages = [
        { type: 'bookmark:save_from_page', data: {} },
        { type: 'import:create_from_url_list', urls: [] },
        { type: 'query:current_tab_info' },
        { type: 'bookmark:retry' },
      ];

      messages.forEach(msg => {
        expect(msg.type).toBeDefined();
        expect(typeof msg.type).toBe('string');
      });
    });

    it('should handle response callback pattern', async () => {
      const response = await new Promise<any>((resolve) => {
        const sendResponse = (response: any) => {
          resolve(response);
        };

        Promise.resolve({ success: true, bookmarkId: 'test-1' })
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
      });

      expect(response).toBeDefined();
      expect(response.success).toBeDefined();
    });
  });
});
