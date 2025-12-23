import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import type { Bookmark } from '../../src/db/schema';
import { StorageError } from '../lib/errors';

export class StorageService extends Context.Tag('StorageService')<
  StorageService,
  {
    readonly updateBookmark: (
      id: string,
      data: Partial<Bookmark>
    ) => Effect.Effect<void, StorageError, never>;

    readonly getMarkdown: (
      bookmarkId: string
    ) => Effect.Effect<{ content: string } | null, StorageError, never>;

    readonly saveMarkdown: (data: {
      id: string;
      bookmarkId: string;
      content: string;
      createdAt: Date;
      updatedAt: Date;
    }) => Effect.Effect<void, StorageError, never>;

    readonly getQuestionAnswers: (
      bookmarkId: string
    ) => Effect.Effect<unknown | null, StorageError, never>;

    readonly saveQuestionAnswers: (
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
    ) => Effect.Effect<void, StorageError, never>;
  }
>() {}
