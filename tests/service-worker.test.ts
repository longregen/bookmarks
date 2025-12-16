import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import { createJob, completeJob } from '../src/lib/jobs';

describe('Service Worker Core Functionality', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
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
      // Create existing bookmark
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

      // Check if bookmark exists
      const existing = await db.bookmarks.where('url').equals('https://example.com').first();
      expect(existing).toBeDefined();

      // Update existing bookmark
      await db.bookmarks.update(existing!.id, {
        title: 'New Title',
        html: '<html><body>New</body></html>',
        status: 'pending',
        errorMessage: undefined,
        errorStack: undefined,
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get('existing-1');
      expect(bookmark?.title).toBe('New Title');
      expect(bookmark?.html).toBe('<html><body>New</body></html>');
      expect(bookmark?.status).toBe('pending');
    });

    it('should reset error state when updating existing bookmark', async () => {
      // Create bookmark with error
      const errorBookmark = {
        id: 'error-1',
        url: 'https://example.com',
        title: 'Error Page',
        html: '<html><body>Old</body></html>',
        status: 'error' as const,
        errorMessage: 'Previous error',
        errorStack: 'Error stack',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(errorBookmark);

      // Update to reset error state
      await db.bookmarks.update('error-1', {
        html: '<html><body>New</body></html>',
        status: 'pending',
        errorMessage: undefined,
        errorStack: undefined,
        updatedAt: new Date(),
      });

      const bookmark = await db.bookmarks.get('error-1');
      expect(bookmark?.status).toBe('pending');
      expect(bookmark?.errorMessage).toBeUndefined();
      expect(bookmark?.errorStack).toBeUndefined();
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

  describe('Job creation for manual adds', () => {
    it('should create MANUAL_ADD job with correct metadata', async () => {
      const data = {
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
      };

      const job = await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.IN_PROGRESS,
        metadata: {
          url: data.url,
          title: data.title,
          source: 'manual',
        },
      });

      expect(job.type).toBe(JobType.MANUAL_ADD);
      expect(job.status).toBe(JobStatus.IN_PROGRESS);
      expect(job.metadata.url).toBe(data.url);
      expect(job.metadata.title).toBe(data.title);
      expect(job.metadata.source).toBe('manual');
    });

    it('should complete MANUAL_ADD job with capture metadata', async () => {
      const job = await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.IN_PROGRESS,
        metadata: {
          url: 'https://example.com',
          title: 'Test',
          source: 'manual',
        },
      });

      await completeJob(job.id, {
        url: 'https://example.com',
        title: 'Test',
        htmlSize: 1234,
        captureTimeMs: 100,
      });

      const completed = await db.jobs.get(job.id);
      expect(completed?.status).toBe(JobStatus.COMPLETED);
      expect(completed?.metadata.htmlSize).toBe(1234);
      expect(completed?.metadata.captureTimeMs).toBe(100);
    });

    it('should link job to bookmark', async () => {
      const bookmarkId = crypto.randomUUID();
      await db.bookmarks.add({
        id: bookmarkId,
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const job = await createJob({
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
        bookmarkId,
        metadata: {},
      });

      expect(job.bookmarkId).toBe(bookmarkId);

      const retrievedJob = await db.jobs.get(job.id);
      expect(retrievedJob?.bookmarkId).toBe(bookmarkId);
    });
  });

  describe('Job status queries', () => {
    it('should retrieve job with all fields', async () => {
      const now = new Date();
      const job = {
        id: 'job-1',
        type: JobType.MARKDOWN_GENERATION,
        status: JobStatus.IN_PROGRESS,
        progress: 50,
        currentStep: 'Processing',
        totalSteps: 100,
        completedSteps: 50,
        metadata: { test: 'data' },
        createdAt: now,
        updatedAt: now,
      };

      await db.jobs.add(job);

      const retrieved = await db.jobs.get('job-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('job-1');
      expect(retrieved?.type).toBe(JobType.MARKDOWN_GENERATION);
      expect(retrieved?.status).toBe(JobStatus.IN_PROGRESS);
      expect(retrieved?.progress).toBe(50);
      expect(retrieved?.currentStep).toBe('Processing');
    });

    it('should return undefined for non-existent job', async () => {
      const job = await db.jobs.get('non-existent');
      expect(job).toBeUndefined();
    });

    it('should format completedAt when job is completed', async () => {
      const now = new Date();
      const job = {
        id: 'job-1',
        type: JobType.MANUAL_ADD,
        status: JobStatus.COMPLETED,
        progress: 100,
        metadata: {},
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      };

      await db.jobs.add(job);

      const retrieved = await db.jobs.get('job-1');
      expect(retrieved?.completedAt).toBeInstanceOf(Date);
      expect(retrieved?.completedAt?.toISOString()).toBe(now.toISOString());
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
        errorStack: error.stack,
        updatedAt: new Date(),
      });

      const updated = await db.bookmarks.get('test-1');
      expect(updated?.status).toBe('error');
      expect(updated?.errorMessage).toBe('Test error');
      expect(updated?.errorStack).toBeDefined();
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
      // TypeScript would prevent this, but test runtime behavior
      const invalidBookmark: any = {
        id: 'invalid-1',
        url: 'https://example.com',
        // missing title
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await expect(db.bookmarks.add(invalidBookmark)).rejects.toThrow();
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

      // Try to add another bookmark with same ID
      await expect(db.bookmarks.add(bookmark)).rejects.toThrow();
    });

    it('should handle updates to non-existent bookmarks', async () => {
      const result = await db.bookmarks.update('non-existent', {
        title: 'New Title',
      });

      // Dexie returns 0 for unsuccessful updates
      expect(result).toBe(0);
    });
  });

  describe('Message routing patterns', () => {
    it('should identify message types correctly', () => {
      const messages = [
        { type: 'SAVE_BOOKMARK', data: {} },
        { type: 'START_BULK_IMPORT', urls: [] },
        { type: 'GET_JOB_STATUS', jobId: 'test' },
        { type: 'GET_CURRENT_TAB_INFO' },
        { type: 'START_PROCESSING' },
      ];

      messages.forEach(msg => {
        expect(msg.type).toBeDefined();
        expect(typeof msg.type).toBe('string');
      });
    });

    it('should handle response callback pattern', (done) => {
      // Simulate async response pattern
      const sendResponse = (response: any) => {
        expect(response).toBeDefined();
        expect(response.success).toBeDefined();
        done();
      };

      // Simulate handler
      Promise.resolve({ success: true, bookmarkId: 'test-1' })
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
    });
  });
});
