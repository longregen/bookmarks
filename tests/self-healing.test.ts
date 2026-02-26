import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/schema';
import {
  runDiagnostics,
  getDiagnosticCounts,
  healNoContent,
  healNoMarkdown,
  healShortMarkdown,
  healNoSummary,
  healNoQuestions,
  healStaleEmbeddings,
  regenerateFromContent,
  regenerateFromMarkdown,
  regenerateFromSummary,
  regenerateFromQuestions,
  regenerateEmbeddings,
} from '../src/lib/self-healing';
import { setPlatformAdapter, type PlatformAdapter, type ApiSettings } from '../src/lib/platform';
import * as api from '../src/lib/api';
import * as extract from '../src/lib/extract';

vi.mock('../src/lib/api', () => ({
  generateQAPairs: vi.fn(),
  generateEmbeddings: vi.fn(),
  generateSummary: vi.fn(),
}));

vi.mock('../src/lib/extract', () => ({
  extractMarkdownAsync: vi.fn(),
}));

vi.mock('../src/lib/browser-fetch', () => ({
  browserFetch: vi.fn().mockResolvedValue({ html: '<html>fetched</html>', title: 'Fetched' }),
}));

const TEST_SETTINGS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  serverUrl: '',
  serverEnabled: false,
  serverSessionToken: '',
  serverSessionExpiry: '',
  serverAuthToken: '',
  serverLastSyncTime: '',
  serverLastSyncError: '',
};

const mockAdapter: PlatformAdapter = {
  getSettings: vi.fn().mockResolvedValue(TEST_SETTINGS),
  saveSetting: vi.fn(),
  getTheme: vi.fn().mockResolvedValue('auto' as const),
  setTheme: vi.fn(),
};

setPlatformAdapter(mockAdapter);

async function clearAllTables(): Promise<void> {
  await db.bookmarks.clear();
  await db.markdown.clear();
  await db.questionsAnswers.clear();
  await db.summaries.clear();
  await db.jobs.clear();
}

function createBookmark(overrides: Partial<{ id: string; html: string; url: string; title: string; status: string }> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Test Page',
    html: overrides.html ?? '<html><body>Test content</body></html>',
    status: (overrides.status ?? 'complete') as 'complete',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Self-Healing Diagnostics', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('runDiagnostics', () => {
    it('should return empty array when all bookmarks are healthy', async () => {
      const bookmark = createBookmark({ id: 'b1' });
      await db.bookmarks.add(bookmark);
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary text',
        embedding: [0.1, 0.2], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      expect(results).toHaveLength(0);
    });

    it('should detect no_content bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));

      const results = await runDiagnostics();
      const noContent = results.find(r => r.type === 'no_content');
      expect(noContent).toBeDefined();
      expect(noContent!.bookmarkIds).toContain('b1');
      expect(noContent!.count).toBe(1);
    });

    it('should detect no_markdown bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      const results = await runDiagnostics();
      const noMarkdown = results.find(r => r.type === 'no_markdown');
      expect(noMarkdown).toBeDefined();
      expect(noMarkdown!.bookmarkIds).toContain('b1');
    });

    it('should detect short_markdown bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const shortMd = results.find(r => r.type === 'short_markdown');
      expect(shortMd).toBeDefined();
      expect(shortMd!.bookmarkIds).toContain('b1');
    });

    it('should detect no_summary bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const noSummary = results.find(r => r.type === 'no_summary');
      expect(noSummary).toBeDefined();
      expect(noSummary!.bookmarkIds).toContain('b1');
    });

    it('should detect no_questions bookmarks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.1], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const noQ = results.find(r => r.type === 'no_questions');
      expect(noQ).toBeDefined();
      expect(noQ!.bookmarkIds).toContain('b1');
    });

    it('should detect stale_embeddings when model differs', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.1], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const stale = results.find(r => r.type === 'stale_embeddings');
      expect(stale).toBeDefined();
      expect(stale!.bookmarkIds).toContain('b1');
    });

    it('should detect stale_embeddings when model is undefined', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'A'.repeat(300),
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.1], embeddingAnswer: [0.2], embeddingBoth: [0.3],
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const stale = results.find(r => r.type === 'stale_embeddings');
      expect(stale).toBeDefined();
      expect(stale!.bookmarkIds).toContain('b1');
    });

    it('should handle multiple issues for the same bookmark', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Short',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = await runDiagnostics();
      const types = results.map(r => r.type);
      expect(types).toContain('short_markdown');
      expect(types).toContain('no_summary');
      expect(types).toContain('no_questions');
    });
  });

  describe('getDiagnosticCounts', () => {
    it('should return zero counts for healthy bookmarks', async () => {
      const counts = await getDiagnosticCounts();
      expect(counts.no_content).toBe(0);
      expect(counts.no_markdown).toBe(0);
      expect(counts.short_markdown).toBe(0);
      expect(counts.no_summary).toBe(0);
      expect(counts.no_questions).toBe(0);
      expect(counts.stale_embeddings).toBe(0);
    });

    it('should return correct counts', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1', html: '' }));
      await db.bookmarks.add(createBookmark({ id: 'b2' }));

      const counts = await getDiagnosticCounts();
      expect(counts.no_content).toBe(1);
      expect(counts.no_markdown).toBe(1);
    });
  });
});

describe('Self-Healing Heal Operations', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();

    vi.spyOn(api, 'generateSummary').mockResolvedValue('Generated summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
      { question: 'Q?', answer: 'A' },
    ]);
    vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
      title: 'Test', content: 'Extracted markdown content that is long enough',
      excerpt: 'Test', byline: null,
    });
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('healNoSummary', () => {
    it('should generate summary for bookmarks missing summaries', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await healNoSummary(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary).toBeDefined();
      expect(summary!.content).toBe('Generated summary');
      expect(summary!.embeddingModel).toBe('text-embedding-3-small');
    });

    it('should not overwrite existing summaries', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Existing summary',
        embedding: [0.1], embeddingModel: 'text-embedding-3-small',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await healNoSummary(['b1']);

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
    });

    it('should skip bookmarks without markdown', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      await healNoSummary(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary).toBeUndefined();
    });

    it('should fire progress callbacks', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const progressCalls: [number, number][] = [];
      await healNoSummary(['b1'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 1]]);
    });
  });

  describe('healNoQuestions', () => {
    it('should generate Q&A pairs for bookmarks missing them', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Some markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healNoQuestions(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('Q?');
      expect(qa[0].embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('healNoMarkdown', () => {
    it('should extract markdown and trigger downstream generation', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await healNoMarkdown(['b1']);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md).toBeDefined();
      expect(md!.content).toBe('Extracted markdown content that is long enough');
    });
  });

  describe('healStaleEmbeddings', () => {
    it('should regenerate embeddings for QA records with stale model', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.9]])
        .mockResolvedValueOnce([[0.8]])
        .mockResolvedValueOnce([[0.7]]);

      await healStaleEmbeddings(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').first();
      expect(qa!.embeddingQuestion).toEqual([0.9]);
      expect(qa!.embeddingModel).toBe('text-embedding-3-small');
    });

    it('should regenerate embeddings for summary records', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings').mockResolvedValueOnce([[0.9]]);

      await healStaleEmbeddings(['b1']);

      const summary = await db.summaries.where('bookmarkId').equals('b1').first();
      expect(summary!.embedding).toEqual([0.9]);
      expect(summary!.embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('abort signal cancellation', () => {
    it('should stop processing when signal is aborted', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example2.com' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content 1',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.markdown.add({
        id: 'md2', bookmarkId: 'b2', content: 'Content 2',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const controller = new AbortController();
      let callCount = 0;

      vi.spyOn(api, 'generateSummary').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          controller.abort();
        }
        return 'summary';
      });

      await healNoSummary(['b1', 'b2'], undefined, controller.signal);

      const summaries = await db.summaries.toArray();
      expect(summaries).toHaveLength(1);
    });
  });
});

describe('Self-Healing Upstream Regeneration', () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.clearAllMocks();

    vi.spyOn(api, 'generateSummary').mockResolvedValue('New summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.5]]);
    vi.spyOn(api, 'generateQAPairs').mockResolvedValue([
      { question: 'New Q?', answer: 'New A' },
    ]);
    vi.spyOn(extract, 'extractMarkdownAsync').mockResolvedValue({
      title: 'Test', content: 'New markdown content',
      excerpt: 'Test', byline: null,
    });
  });

  afterEach(async () => {
    await clearAllTables();
  });

  describe('regenerateFromSummary', () => {
    it('should delete existing summary and regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await regenerateFromSummary(['b1']);

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('New summary');
      expect(summaries[0].embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('regenerateFromQuestions', () => {
    it('should delete existing Q&A and regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Markdown content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.1]])
        .mockResolvedValueOnce([[0.2]])
        .mockResolvedValueOnce([[0.3]]);

      await regenerateFromQuestions(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').toArray();
      expect(qa).toHaveLength(1);
      expect(qa[0].question).toBe('New Q?');
    });
  });

  describe('regenerateFromMarkdown', () => {
    it('should delete markdown, summary, and questions then regenerate', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Old markdown',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.summaries.add({
        id: 's1', bookmarkId: 'b1', content: 'Old summary',
        embedding: [0.0], embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Old Q?', answer: 'Old A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        createdAt: new Date(), updatedAt: new Date(),
      });

      await regenerateFromMarkdown(['b1']);

      const md = await db.markdown.where('bookmarkId').equals('b1').first();
      expect(md!.content).toBe('New markdown content');

      const summaries = await db.summaries.where('bookmarkId').equals('b1').toArray();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].content).toBe('New summary');
    });
  });

  describe('regenerateEmbeddings', () => {
    it('should regenerate embeddings without changing text content', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.questionsAnswers.add({
        id: 'qa1', bookmarkId: 'b1', question: 'Q?', answer: 'A',
        embeddingQuestion: [0.0], embeddingAnswer: [0.0], embeddingBoth: [0.0],
        embeddingModel: 'old-model',
        createdAt: new Date(), updatedAt: new Date(),
      });

      vi.spyOn(api, 'generateEmbeddings')
        .mockResolvedValueOnce([[0.9]])
        .mockResolvedValueOnce([[0.8]])
        .mockResolvedValueOnce([[0.7]]);

      await regenerateEmbeddings(['b1']);

      const qa = await db.questionsAnswers.where('bookmarkId').equals('b1').first();
      expect(qa!.question).toBe('Q?');
      expect(qa!.answer).toBe('A');
      expect(qa!.embeddingQuestion).toEqual([0.9]);
      expect(qa!.embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('progress callbacks for regeneration', () => {
    it('should fire progress callbacks during regeneration', async () => {
      await db.bookmarks.add(createBookmark({ id: 'b1' }));
      await db.bookmarks.add(createBookmark({ id: 'b2', url: 'https://example2.com' }));
      await db.markdown.add({
        id: 'md1', bookmarkId: 'b1', content: 'Content',
        createdAt: new Date(), updatedAt: new Date(),
      });
      await db.markdown.add({
        id: 'md2', bookmarkId: 'b2', content: 'Content 2',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const progressCalls: [number, number][] = [];
      await regenerateFromSummary(['b1', 'b2'], (done, total) => progressCalls.push([done, total]));

      expect(progressCalls).toEqual([[1, 2], [2, 2]]);
    });
  });
});

describe('generateSummary API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be called with markdown content during heal', async () => {
    await clearAllTables();

    await db.bookmarks.add(createBookmark({ id: 'b1' }));
    await db.markdown.add({
      id: 'md1', bookmarkId: 'b1', content: 'Test markdown for summary',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const summaryMock = vi.spyOn(api, 'generateSummary').mockResolvedValue('Generated summary');
    vi.spyOn(api, 'generateEmbeddings').mockResolvedValue([[0.1]]);

    await healNoSummary(['b1']);

    expect(summaryMock).toHaveBeenCalledWith('Test markdown for summary');

    await clearAllTables();
  });
});
