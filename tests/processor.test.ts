import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import { processBookmark } from '../src/background/processor';
import * as extract from '../src/lib/extract';
import * as api from '../src/lib/api';

vi.mock('../src/lib/extract', () => ({
  extractMarkdownAsync: vi.fn(),
}));

vi.mock('../src/lib/api', () => ({
  generateQAPairs: vi.fn(),
  generateEmbeddings: vi.fn(),
}));

describe('Bookmark Processor', () => {
  beforeEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.markdown.clear();
    await db.questionsAnswers.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.bookmarks.clear();
    await db.jobs.clear();
    await db.markdown.clear();
    await db.questionsAnswers.clear();
  });

  describe('processBookmark', () => {
    it('should process a bookmark successfully', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test content</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      const extractMock = vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test Page',
        content: 'Test markdown content',
        excerpt: 'Test excerpt',
        byline: 'Test Author',
      });

      const qaPairsMock = vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'What is this?', answer: 'This is a test' },
      ]);

      const embeddingsMock = vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([
        [0.1, 0.2, 0.3],
      ]);

      await processBookmark(bookmark);

      expect(extractMock).toHaveBeenCalledWith(bookmark.html, bookmark.url);
      expect(qaPairsMock).toHaveBeenCalledWith('Test markdown content');
      expect(embeddingsMock).toHaveBeenCalledTimes(3);

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('complete');

      const markdown = await db.markdown.where('bookmarkId').equals('test-1').first();
      expect(markdown?.content).toBe('Test markdown content');

      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals('test-1').toArray();
      expect(qaPairs).toHaveLength(1);
      expect(qaPairs[0].question).toBe('What is this?');
      expect(qaPairs[0].answer).toBe('This is a test');
    });

    it('should update bookmark to processing status', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockImplementation(async () => {
        const bookmark = await db.bookmarks.get('test-1');
        expect(bookmark?.status).toBe('processing');

        return {
          title: 'Test',
          content: 'Test content',
          excerpt: 'Test',
          byline: null,
        };
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([]);
      vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([]);

      await processBookmark(bookmark);
    });

    it('should create markdown generation job', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q?', answer: 'A' },
      ]);

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1, 0.2]]);

      await processBookmark(bookmark);

      const jobs = await db.jobs.where('type').equals(JobType.MARKDOWN_GENERATION).toArray();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe(JobStatus.COMPLETED);
      expect(jobs[0].bookmarkId).toBe('test-1');
    });

    it('should create QA generation job', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q?', answer: 'A' },
      ]);

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1, 0.2]]);

      await processBookmark(bookmark);

      const jobs = await db.jobs.where('type').equals(JobType.QA_GENERATION).toArray();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe(JobStatus.COMPLETED);
      expect(jobs[0].bookmarkId).toBe('test-1');
    });

    it('should handle empty Q&A pairs gracefully', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Short content</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Short',
        excerpt: 'Short',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([]);

      await processBookmark(bookmark);

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('complete');

      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals('test-1').toArray();
      expect(qaPairs).toHaveLength(0);
    });

    it('should save embeddings for Q&A pairs', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'What is this?', answer: 'This is a test' },
      ]);

      const questionEmbedding = [0.1, 0.2, 0.3];
      const answerEmbedding = [0.4, 0.5, 0.6];
      const combinedEmbedding = [0.7, 0.8, 0.9];

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([questionEmbedding])
        .mockResolvedValueOnce([answerEmbedding])
        .mockResolvedValueOnce([combinedEmbedding]);

      await processBookmark(bookmark);

      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals('test-1').toArray();
      expect(qaPairs).toHaveLength(1);
      expect(qaPairs[0].embeddingQuestion).toEqual(questionEmbedding);
      expect(qaPairs[0].embeddingAnswer).toEqual(answerEmbedding);
      expect(qaPairs[0].embeddingBoth).toEqual(combinedEmbedding);
    });

    it('should handle extraction errors', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockRejectedValue(new Error('Extraction failed'));

      await expect(processBookmark(bookmark)).rejects.toThrow('Extraction failed');

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('error');
      expect(updatedBookmark?.errorMessage).toBe('Extraction failed');
    });

    it('should handle Q&A generation errors', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockRejectedValue(new Error('API failed'));

      await expect(processBookmark(bookmark)).rejects.toThrow('API failed');

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('error');
      expect(updatedBookmark?.errorMessage).toBe('API failed');
    });

    it('should handle embedding generation errors', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q?', answer: 'A' },
      ]);

      vi.spyOn(api, 'generateEmbeddings').mockRejectedValue(new Error('Embedding failed'));

      await expect(processBookmark(bookmark)).rejects.toThrow('Embedding failed');

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.status).toBe('error');
      expect(updatedBookmark?.errorMessage).toBe('Embedding failed');
    });

    it('should mark jobs as failed on error', async () => {
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

      vi.spyOn(extract, 'extractMarkdownAsync').mockRejectedValue(new Error('Test error'));

      await expect(processBookmark(bookmark)).rejects.toThrow('Test error');

      const failedJobs = await db.jobs.where('status').equals(JobStatus.FAILED).toArray();
      expect(failedJobs.length).toBeGreaterThan(0);
    });

    it('should process multiple Q&A pairs', async () => {
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Long content</body></html>',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Long test content',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q1?', answer: 'A1' },
        { question: 'Q2?', answer: 'A2' },
        { question: 'Q3?', answer: 'A3' },
      ]);

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1], [0.2], [0.3]])
        .mockResolvedValueOnce([[0.4], [0.5], [0.6]])
        .mockResolvedValueOnce([[0.7], [0.8], [0.9]]);

      await processBookmark(bookmark);

      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals('test-1').toArray();
      expect(qaPairs).toHaveLength(3);
      qaPairs.sort((a, b) => a.question.localeCompare(b.question));
      expect(qaPairs.map(qa => qa.question)).toEqual(['Q1?', 'Q2?', 'Q3?']);
      expect(qaPairs.map(qa => qa.answer)).toEqual(['A1', 'A2', 'A3']);
    });

    it('should save markdown with correct metadata', async () => {
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

      const markdownContent = 'Test markdown content';

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: markdownContent,
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q?', answer: 'A' },
      ]);

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1]]);

      await processBookmark(bookmark);

      const markdown = await db.markdown.where('bookmarkId').equals('test-1').first();
      expect(markdown).toBeDefined();
      expect(markdown?.content).toBe(markdownContent);
      expect(markdown?.bookmarkId).toBe('test-1');
      expect(markdown?.createdAt).toBeInstanceOf(Date);
      expect(markdown?.updatedAt).toBeInstanceOf(Date);
    });

    it('should include error stack in bookmark on failure', async () => {
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

      const error = new Error('Test error with stack');
      vi.spyOn(extract, 'extractMarkdownAsync').mockRejectedValue(error);

      await expect(processBookmark(bookmark)).rejects.toThrow('Test error with stack');

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.errorMessage).toBe('Test error with stack');
      expect(updatedBookmark?.errorStack).toBeDefined();
      expect(updatedBookmark?.errorStack).toContain('Error: Test error with stack');
    });

    it('should update bookmark updatedAt timestamp', async () => {
      const createdAt = new Date(Date.now() - 1000);
      const bookmark = {
        id: 'test-1',
        url: 'https://example.com',
        title: 'Test Page',
        html: '<html><body>Test</body></html>',
        status: 'pending' as const,
        createdAt,
        updatedAt: createdAt,
      };

      await db.bookmarks.add(bookmark);

      vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
        title: 'Test',
        content: 'Test',
        excerpt: 'Test',
        byline: null,
      });

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
        { question: 'Q?', answer: 'A' },
      ]);

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1]]);

      await processBookmark(bookmark);

      const updatedBookmark = await db.bookmarks.get('test-1');
      expect(updatedBookmark?.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    });
  });
});
