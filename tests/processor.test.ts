import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
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

vi.mock('../src/lib/browser-fetch', () => ({
  browserFetch: vi.fn(),
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

      const markdown = await db.markdown.where('bookmarkId').equals('test-1').first();
      expect(markdown?.content).toBe('Test markdown content');

      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals('test-1').toArray();
      expect(qaPairs).toHaveLength(1);
      expect(qaPairs[0].question).toBe('What is this?');
      expect(qaPairs[0].answer).toBe('This is a test');
    });

    it('should skip markdown generation if already exists', async () => {
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

      // Pre-create markdown
      await db.markdown.add({
        id: 'md-1',
        bookmarkId: 'test-1',
        content: 'Existing markdown',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const extractMock = vi.spyOn(extract, 'extractMarkdownAsync');

      vi.spyOn(api, 'generateQAPairs').mockResolvedValue([]);

      await processBookmark(bookmark);

      expect(extractMock).not.toHaveBeenCalled();
    });

    it('should skip Q&A generation if already exists', async () => {
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

      // Pre-create Q&A
      await db.questionsAnswers.add({
        id: 'qa-1',
        bookmarkId: 'test-1',
        question: 'Existing Q',
        answer: 'Existing A',
        embeddingQuestion: [0.1],
        embeddingAnswer: [0.2],
        embeddingBoth: [0.3],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const qaPairsMock = vi.spyOn(api, 'generateQAPairs');

      await processBookmark(bookmark);

      expect(qaPairsMock).not.toHaveBeenCalled();
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

    it('should throw on extraction errors', async () => {
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
    });

    it('should throw on Q&A generation errors', async () => {
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
    });

    it('should throw on embedding generation errors', async () => {
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
  });
});
