import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Data from 'effect/Data';
import { db } from '../../src/db/schema';
import type { Bookmark, BookmarkTag } from '../db/schema';
import { groupBy, makeLayer } from '../lib/effect-utils';

// ============================================================================
// Errors
// ============================================================================

export class BookmarkRepositoryError extends Data.TaggedError('BookmarkRepositoryError')<{
  readonly operation: 'getAll' | 'getByTag' | 'getUntagged' | 'getComplete';
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TagRepositoryError extends Data.TaggedError('TagRepositoryError')<{
  readonly operation: 'getAll' | 'getForBookmarks' | 'getTaggedBookmarkIds' | 'getBookmarksByTags';
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Service Definitions
// ============================================================================

export class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly getAll: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getByTag: (
      tagName: string
    ) => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getUntagged: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
    readonly getComplete: () => Effect.Effect<Bookmark[], BookmarkRepositoryError>;
  }
>() {}

export class TagRepository extends Context.Tag('TagRepository')<
  TagRepository,
  {
    readonly getAll: () => Effect.Effect<BookmarkTag[], TagRepositoryError>;
    readonly getForBookmarks: (
      bookmarkIds: string[]
    ) => Effect.Effect<Map<string, BookmarkTag[]>, TagRepositoryError>;
    readonly getTaggedBookmarkIds: () => Effect.Effect<Set<string>, TagRepositoryError>;
    readonly getBookmarksByTags: (
      tagNames: string[]
    ) => Effect.Effect<Set<string>, TagRepositoryError>;
  }
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

export const BookmarkRepositoryLive = makeLayer(BookmarkRepository, {
  getAll: () =>
    Effect.tryPromise({
      try: () => db.bookmarks.toArray(),
      catch: (error) =>
        new BookmarkRepositoryError({
          operation: 'getAll',
          message: 'Failed to fetch all bookmarks',
          cause: error,
        }),
    }),

  getByTag: (tagName: string) =>
    Effect.tryPromise({
      try: async () => {
        const tagRecords = await db.bookmarkTags
          .where('tagName')
          .equals(tagName)
          .toArray();
        const taggedIds = tagRecords.map((t) => t.bookmarkId);
        return await db.bookmarks.where('id').anyOf(taggedIds).toArray();
      },
      catch: (error) =>
        new BookmarkRepositoryError({
          operation: 'getByTag',
          message: `Failed to fetch bookmarks for tag: ${tagName}`,
          cause: error,
        }),
    }),

  getUntagged: () =>
    Effect.tryPromise({
      try: async () => {
        const allBookmarks = await db.bookmarks.toArray();
        const taggedIds = new Set(
          (await db.bookmarkTags.toArray()).map((t) => t.bookmarkId)
        );
        return allBookmarks.filter((b) => !taggedIds.has(b.id));
      },
      catch: (error) =>
        new BookmarkRepositoryError({
          operation: 'getUntagged',
          message: 'Failed to fetch untagged bookmarks',
          cause: error,
        }),
    }),

  getComplete: () =>
    Effect.tryPromise({
      try: () => db.bookmarks.where('status').equals('complete').toArray(),
      catch: (error) =>
        new BookmarkRepositoryError({
          operation: 'getComplete',
          message: 'Failed to fetch complete bookmarks',
          cause: error,
        }),
    }),
});

export const TagRepositoryLive = makeLayer(TagRepository, {
  getAll: () =>
    Effect.tryPromise({
      try: () => db.bookmarkTags.toArray(),
      catch: (error) =>
        new TagRepositoryError({
          operation: 'getAll',
          message: 'Failed to fetch all tags',
          cause: error,
        }),
    }),

  getForBookmarks: (bookmarkIds: string[]) =>
    Effect.tryPromise({
      try: async () => {
        const allTags = await db.bookmarkTags
          .where('bookmarkId')
          .anyOf(bookmarkIds)
          .toArray();

        return groupBy(allTags, (tag) => tag.bookmarkId);
      },
      catch: (error) =>
        new TagRepositoryError({
          operation: 'getForBookmarks',
          message: 'Failed to fetch tags for bookmarks',
          cause: error,
        }),
    }),

  getTaggedBookmarkIds: () =>
    Effect.tryPromise({
      try: async () => {
        const allTags = await db.bookmarkTags.toArray();
        return new Set(allTags.map((t) => t.bookmarkId));
      },
      catch: (error) =>
        new TagRepositoryError({
          operation: 'getAll',
          message: 'Failed to fetch tagged bookmark IDs',
          cause: error,
        }),
    }),

  getBookmarksByTags: (tagNames: string[]) =>
    Effect.tryPromise({
      try: async () => {
        const tagResults = await db.bookmarkTags
          .where('tagName')
          .anyOf(tagNames)
          .toArray();
        return new Set(tagResults.map((t) => t.bookmarkId));
      },
      catch: (error) =>
        new TagRepositoryError({
          operation: 'getBookmarksByTags',
          message: 'Failed to filter bookmarks by tags',
          cause: error,
        }),
    }),
});

export const RepositoryLayerLive = Layer.mergeAll(
  BookmarkRepositoryLive,
  TagRepositoryLive
);
