import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import type { Bookmark } from '../../src/db/schema';

// ============================================================================
// Error Types
// ============================================================================

export class FetchError extends Data.TaggedError('FetchError')<{
  url: string;
  message: string;
  cause?: unknown;
}> {}

export class MarkdownError extends Data.TaggedError('MarkdownError')<{
  bookmarkId: string;
  message: string;
  cause?: unknown;
}> {}

export class QAGenerationError extends Data.TaggedError('QAGenerationError')<{
  bookmarkId: string;
  message: string;
  cause?: unknown;
}> {}

export class EmbeddingError extends Data.TaggedError('EmbeddingError')<{
  message: string;
  cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError('StorageError')<{
  operation: string;
  table: string;
  message: string;
  cause?: unknown;
}> {}

// ============================================================================
// Service Interfaces
// ============================================================================

export class StorageService extends Context.Tag('StorageService')<
  StorageService,
  {
    updateBookmark(
      id: string,
      data: Partial<Bookmark>
    ): Effect.Effect<void, StorageError>;

    getMarkdown(
      bookmarkId: string
    ): Effect.Effect<{ content: string } | null, StorageError>;

    saveMarkdown(data: {
      id: string;
      bookmarkId: string;
      content: string;
      createdAt: Date;
      updatedAt: Date;
    }): Effect.Effect<void, StorageError>;

    getQuestionAnswers(
      bookmarkId: string
    ): Effect.Effect<unknown | null, StorageError>;

    saveQuestionAnswers(
      records: Array<{
        id: string;
        bookmarkId: string;
        question: string;
        answer: string;
        embeddingQuestion: number[];
        embeddingAnswer: number[];
        embeddingBoth: number[];
        createdAt: Date;
        updatedAt: Date;
      }>
    ): Effect.Effect<void, StorageError>;
  }
>() {}

export class FetchService extends Context.Tag('FetchService')<
  FetchService,
  {
    fetchHtml(
      url: string,
      timeout: number
    ): Effect.Effect<{ html: string; title: string | null }, FetchError>;
  }
>() {}

export class MarkdownService extends Context.Tag('MarkdownService')<
  MarkdownService,
  {
    extract(
      html: string,
      url: string
    ): Effect.Effect<{ content: string }, MarkdownError>;
  }
>() {}

export class QAService extends Context.Tag('QAService')<
  QAService,
  {
    generatePairs(
      markdownContent: string
    ): Effect.Effect<Array<{ question: string; answer: string }>, QAGenerationError>;
  }
>() {}

export class EmbeddingService extends Context.Tag('EmbeddingService')<
  EmbeddingService,
  {
    generate(texts: string[]): Effect.Effect<number[][], EmbeddingError>;
  }
>() {}

export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  {
    getFetchTimeout(): Effect.Effect<number>;
  }
>() {}

export class TitleExtractor extends Context.Tag('TitleExtractor')<
  TitleExtractor,
  {
    extractFromHtml(html: string): Effect.Effect<string | null>;
  }
>() {}

// ============================================================================
// Core Processing Functions
// ============================================================================

export const fetchBookmarkHtml = (
  bookmark: Bookmark
): Effect.Effect<
  Bookmark,
  FetchError | StorageError,
  FetchService | ConfigService | TitleExtractor | StorageService
> =>
  Effect.gen(function* () {
    if (bookmark.html && bookmark.html.length > 0) {
      return bookmark;
    }

    const fetchService = yield* FetchService;
    const configService = yield* ConfigService;
    const titleExtractor = yield* TitleExtractor;
    const storageService = yield* StorageService;

    yield* Effect.log(`[Processor] Fetching HTML for: ${bookmark.url}`);

    const timeout = yield* configService.getFetchTimeout();
    const captured = yield* fetchService.fetchHtml(bookmark.url, timeout);

    const extractedTitle = yield* titleExtractor.extractFromHtml(captured.html);
    const title = captured.title || extractedTitle || bookmark.title || bookmark.url;

    yield* storageService.updateBookmark(bookmark.id, {
      html: captured.html,
      title,
      status: 'downloaded',
      updatedAt: new Date(),
    });

    return {
      ...bookmark,
      html: captured.html,
      title,
      status: 'downloaded' as const,
    };
  });

const generateMarkdownIfNeeded = (
  bookmark: Bookmark
): Effect.Effect<
  string,
  MarkdownError | StorageError,
  StorageService | MarkdownService
> =>
  Effect.gen(function* () {
    const storageService = yield* StorageService;
    const markdownService = yield* MarkdownService;

    const existing = yield* storageService.getMarkdown(bookmark.id);
    if (existing) {
      yield* Effect.log(`[Processor] Markdown already exists for: ${bookmark.title}`);
      return existing.content;
    }

    yield* Effect.log(`[Processor] Extracting markdown for: ${bookmark.title}`);
    const extracted = yield* markdownService.extract(bookmark.html, bookmark.url);

    yield* storageService.saveMarkdown({
      id: crypto.randomUUID(),
      bookmarkId: bookmark.id,
      content: extracted.content,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    yield* Effect.log(`[Processor] Saved markdown (${extracted.content.length} chars)`);
    return extracted.content;
  });

const generateQAIfNeeded = (
  bookmark: Bookmark,
  markdownContent: string
): Effect.Effect<
  void,
  QAGenerationError | EmbeddingError | StorageError,
  StorageService | QAService | EmbeddingService
> =>
  Effect.gen(function* () {
    const storageService = yield* StorageService;
    const qaService = yield* QAService;
    const embeddingService = yield* EmbeddingService;

    const existingQA = yield* storageService.getQuestionAnswers(bookmark.id);
    if (existingQA) {
      yield* Effect.log(`[Processor] Q&A already exists for: ${bookmark.title}`);
      return;
    }

    yield* Effect.log(`[Processor] Generating Q&A for: ${bookmark.title}`);
    const qaPairs = yield* qaService.generatePairs(markdownContent);

    if (qaPairs.length === 0) {
      yield* Effect.log(`[Processor] No Q&A pairs generated for: ${bookmark.title}`);
      return;
    }

    yield* Effect.log(
      `[Processor] Generating embeddings for ${qaPairs.length} Q&A pairs`
    );

    const questions = qaPairs.map((qa) => qa.question);
    const answers = qaPairs.map((qa) => qa.answer);
    const combined = qaPairs.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`);

    const [questionEmbeddings, answerEmbeddings, combinedEmbeddings] = yield* Effect.all(
      [
        embeddingService.generate(questions),
        embeddingService.generate(answers),
        embeddingService.generate(combined),
      ],
      { concurrency: 'unbounded' }
    );

    yield* Effect.log(`[Processor] Saving ${qaPairs.length} Q&A pairs with embeddings`);

    const qaRecords = qaPairs.map((qa, i) => ({
      id: crypto.randomUUID(),
      bookmarkId: bookmark.id,
      question: qa.question,
      answer: qa.answer,
      embeddingQuestion: questionEmbeddings[i],
      embeddingAnswer: answerEmbeddings[i],
      embeddingBoth: combinedEmbeddings[i],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    yield* storageService.saveQuestionAnswers(qaRecords);

    yield* Effect.log(`[Processor] Completed Q&A generation for: ${bookmark.title}`);
  });

export const processBookmarkContent = (
  bookmark: Bookmark
): Effect.Effect<
  void,
  FetchError | MarkdownError | QAGenerationError | EmbeddingError | StorageError,
  | FetchService
  | ConfigService
  | TitleExtractor
  | StorageService
  | MarkdownService
  | QAService
  | EmbeddingService
> =>
  Effect.gen(function* () {
    let bookmarkWithHtml = bookmark;
    if (!bookmark.html || bookmark.html.length === 0) {
      bookmarkWithHtml = yield* fetchBookmarkHtml(bookmark);
    }

    const markdownContent = yield* generateMarkdownIfNeeded(bookmarkWithHtml);

    yield* generateQAIfNeeded(bookmarkWithHtml, markdownContent);
  });

export const processBookmark = (
  bookmark: Bookmark
): Effect.Effect<
  void,
  FetchError | MarkdownError | QAGenerationError | EmbeddingError | StorageError,
  | FetchService
  | ConfigService
  | TitleExtractor
  | StorageService
  | MarkdownService
  | QAService
  | EmbeddingService
> => processBookmarkContent(bookmark);
