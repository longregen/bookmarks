import * as Effect from 'effect/Effect';
import type { Bookmark } from '../../src/db/schema';
import {
  FetchError,
  MarkdownError,
  QAGenerationError,
  EmbeddingError,
  StorageError,
} from '../lib/errors';
import { StorageService } from '../services/storage-service';
import { FetchService } from '../services/fetch-service';
import { MarkdownService } from '../services/markdown-service';
import { QAService } from '../services/qa-service';
import { EmbeddingService } from '../services/embedding-service';
import { ConfigService } from '../services/config-service';
import { TitleExtractor } from '../services/title-extractor';

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
