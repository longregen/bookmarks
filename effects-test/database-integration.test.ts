import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Context from 'effect/Context';
import { Data } from 'effect';
import type {
  Bookmark,
  BookmarkTag,
  Markdown,
  QuestionAnswer,
  Settings,
  Job,
  JobItem,
  SearchHistory,
  TableName,
  BookmarkStatus,
  JobType,
  JobStatus,
  JobItemStatus,
  QueryFilter,
} from '../effect/db/schema';
import {
  SchemaValidationError,
  DatabaseSchemaError,
  ConstraintViolationError,
  EntityNotFoundError,
  SCHEMA_VERSION,
  DATABASE_NAME,
  SCHEMA,
} from '../effect/db/schema';
import {
  StorageError,
  RepositoryError,
} from '../effect/lib/errors';

// ============================================================================
// Mock Storage Service
// ============================================================================

/**
 * In-memory storage for testing database operations
 */
class MockStorage {
  private stores: Map<TableName, Map<string, any>>;

  constructor() {
    this.stores = new Map();
    this.initializeStores();
  }

  private initializeStores(): void {
    const tableNames: TableName[] = [
      'bookmarks',
      'markdown',
      'questionsAnswers',
      'settings',
      'jobs',
      'jobItems',
      'bookmarkTags',
      'searchHistory',
    ];

    for (const tableName of tableNames) {
      this.stores.set(tableName, new Map());
    }
  }

  reset(): void {
    this.stores.clear();
    this.initializeStores();
  }

  getStore<T>(tableName: TableName): Map<string, T> {
    const store = this.stores.get(tableName);
    if (!store) {
      throw new Error(`Store not found: ${tableName}`);
    }
    return store as Map<string, T>;
  }

  get<T>(tableName: TableName, id: string): T | undefined {
    return this.getStore<T>(tableName).get(id);
  }

  set<T>(tableName: TableName, id: string, value: T): void {
    this.getStore<T>(tableName).set(id, value);
  }

  delete(tableName: TableName, id: string): boolean {
    return this.getStore(tableName).delete(id);
  }

  has(tableName: TableName, id: string): boolean {
    return this.getStore(tableName).has(id);
  }

  getAll<T>(tableName: TableName): T[] {
    return Array.from(this.getStore<T>(tableName).values());
  }

  bulkGet<T>(tableName: TableName, ids: readonly string[]): (T | undefined)[] {
    return ids.map((id) => this.get<T>(tableName, id));
  }

  bulkPut<T extends { id?: string }>(
    tableName: TableName,
    items: readonly T[],
    keyPath: string = 'id'
  ): void {
    const store = this.getStore<T>(tableName);
    for (const item of items) {
      const key = (item as any)[keyPath];
      if (key === undefined) {
        throw new Error(`Key not found in item: ${keyPath}`);
      }
      store.set(key, item);
    }
  }

  query<T>(
    tableName: TableName,
    filter: QueryFilter
  ): T[] {
    let results = this.getAll<T>(tableName);

    // Apply field filtering
    if (filter.field && filter.operator && filter.value !== undefined) {
      results = results.filter((item: any) => {
        const fieldValue = item[filter.field!];

        switch (filter.operator) {
          case 'eq':
            return fieldValue === filter.value;
          case 'contains':
            return String(fieldValue).includes(String(filter.value));
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(fieldValue);
          case 'gte':
            return fieldValue >= filter.value;
          case 'lte':
            return fieldValue <= filter.value;
          case 'range':
            if (Array.isArray(filter.value) && filter.value.length === 2) {
              return fieldValue >= filter.value[0] && fieldValue <= filter.value[1];
            }
            return false;
          default:
            return true;
        }
      });
    }

    // Apply sorting
    if (filter.sort && filter.sort.length > 0) {
      results.sort((a: any, b: any) => {
        for (const sortSpec of filter.sort!) {
          const aVal = a[sortSpec.field];
          const bVal = b[sortSpec.field];

          if (aVal < bVal) return sortSpec.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return sortSpec.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    // Apply offset and limit
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  count(tableName: TableName): number {
    return this.getStore(tableName).size;
  }

  where<T>(
    tableName: TableName,
    field: string,
    operator: 'equals' | 'anyOf',
    value: any
  ): T[] {
    const results = this.getAll<T>(tableName);

    if (operator === 'equals') {
      return results.filter((item: any) => item[field] === value);
    }

    if (operator === 'anyOf' && Array.isArray(value)) {
      return results.filter((item: any) => value.includes(item[field]));
    }

    return [];
  }
}

// ============================================================================
// Mock Storage Service Layer
// ============================================================================

class MockStorageService extends Context.Tag('MockStorageService')<
  MockStorageService,
  {
    // CRUD operations
    readonly get: <T>(
      table: TableName,
      id: string
    ) => Effect.Effect<T | undefined, StorageError>;

    readonly put: <T extends { id?: string }>(
      table: TableName,
      item: T,
      keyPath?: string
    ) => Effect.Effect<void, StorageError>;

    readonly delete: (
      table: TableName,
      id: string
    ) => Effect.Effect<boolean, StorageError>;

    readonly getAll: <T>(table: TableName) => Effect.Effect<T[], StorageError>;

    // Batch operations
    readonly bulkGet: <T>(
      table: TableName,
      ids: readonly string[]
    ) => Effect.Effect<(T | undefined)[], StorageError>;

    readonly bulkPut: <T extends { id?: string }>(
      table: TableName,
      items: readonly T[],
      keyPath?: string
    ) => Effect.Effect<void, StorageError>;

    // Query operations
    readonly query: <T>(
      table: TableName,
      filter: QueryFilter
    ) => Effect.Effect<T[], StorageError>;

    readonly where: <T>(
      table: TableName,
      field: string,
      operator: 'equals' | 'anyOf',
      value: any
    ) => Effect.Effect<T[], StorageError>;

    readonly count: (table: TableName) => Effect.Effect<number, StorageError>;

    // Test utilities
    readonly reset: () => Effect.Effect<void, never>;
  }
>() {}

function createMockStorageLayer(mockStorage: MockStorage): Layer.Layer<MockStorageService> {
  return Layer.succeed(MockStorageService, {
    get: <T>(table: TableName, id: string) =>
      Effect.try({
        try: () => mockStorage.get<T>(table, id),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'read',
            table,
            message: `Failed to get item from ${table}`,
            originalError: error,
          }),
      }),

    put: <T extends { id?: string }>(table: TableName, item: T, keyPath: string = 'id') =>
      Effect.try({
        try: () => {
          // Try to get the key from the item's property first
          let key = (item as any)[keyPath];
          // If not found, use keyPath as the literal key value (for compound keys)
          if (key === undefined) {
            key = keyPath;
          }
          mockStorage.set(table, key, item);
        },
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'write',
            table,
            message: `Failed to put item in ${table}`,
            originalError: error,
          }),
      }),

    delete: (table: TableName, id: string) =>
      Effect.try({
        try: () => mockStorage.delete(table, id),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'delete',
            table,
            message: `Failed to delete item from ${table}`,
            originalError: error,
          }),
      }),

    getAll: <T>(table: TableName) =>
      Effect.try({
        try: () => mockStorage.getAll<T>(table),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'query',
            table,
            message: `Failed to get all items from ${table}`,
            originalError: error,
          }),
      }),

    bulkGet: <T>(table: TableName, ids: readonly string[]) =>
      Effect.try({
        try: () => mockStorage.bulkGet<T>(table, ids),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'query',
            table,
            message: `Failed to bulk get items from ${table}`,
            originalError: error,
          }),
      }),

    bulkPut: <T extends { id?: string }>(
      table: TableName,
      items: readonly T[],
      keyPath: string = 'id'
    ) =>
      Effect.try({
        try: () => mockStorage.bulkPut(table, items, keyPath),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'write',
            table,
            message: `Failed to bulk put items in ${table}`,
            originalError: error,
          }),
      }),

    query: <T>(table: TableName, filter: QueryFilter) =>
      Effect.try({
        try: () => mockStorage.query<T>(table, filter),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'query',
            table,
            message: `Failed to query ${table}`,
            originalError: error,
          }),
      }),

    where: <T>(table: TableName, field: string, operator: 'equals' | 'anyOf', value: any) =>
      Effect.try({
        try: () => mockStorage.where<T>(table, field, operator, value),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'query',
            table,
            message: `Failed to query ${table} where ${field}`,
            originalError: error,
          }),
      }),

    count: (table: TableName) =>
      Effect.try({
        try: () => mockStorage.count(table),
        catch: (error) =>
          new StorageError({
            code: 'UNKNOWN',
            operation: 'query',
            table,
            message: `Failed to count items in ${table}`,
            originalError: error,
          }),
      }),

    reset: () => Effect.sync(() => mockStorage.reset()),
  });
}

// ============================================================================
// Repository Implementations
// ============================================================================

class BookmarkRepository extends Context.Tag('BookmarkRepository')<
  BookmarkRepository,
  {
    readonly create: (
      bookmark: Bookmark
    ) => Effect.Effect<Bookmark, RepositoryError, MockStorageService>;

    readonly getById: (
      id: string
    ) => Effect.Effect<Bookmark, RepositoryError | EntityNotFoundError, MockStorageService>;

    readonly update: (
      id: string,
      updates: Partial<Bookmark>
    ) => Effect.Effect<Bookmark, RepositoryError, MockStorageService>;

    readonly delete: (
      id: string
    ) => Effect.Effect<void, RepositoryError, MockStorageService>;

    readonly getAll: () => Effect.Effect<Bookmark[], RepositoryError, MockStorageService>;

    readonly getByStatus: (
      status: BookmarkStatus
    ) => Effect.Effect<Bookmark[], RepositoryError, MockStorageService>;

    readonly bulkCreate: (
      bookmarks: readonly Bookmark[]
    ) => Effect.Effect<void, RepositoryError, MockStorageService>;
  }
>() {}

const BookmarkRepositoryLive = Layer.effect(
  BookmarkRepository,
  Effect.gen(function* () {
    const storage = yield* MockStorageService;

    return {
      create: (bookmark: Bookmark) =>
        Effect.gen(function* () {
          // Check for duplicate URL (unique constraint)
          const existing = yield* storage.getAll<Bookmark>('bookmarks');
          const duplicate = existing.find((b) => b.url === bookmark.url);

          if (duplicate) {
            return yield* Effect.fail(
              new RepositoryError({
                code: 'CONSTRAINT_VIOLATION',
                entity: 'bookmark',
                operation: 'create',
                message: `Bookmark with URL already exists: ${bookmark.url}`,
              })
            );
          }

          yield* storage.put('bookmarks', bookmark);
          return bookmark;
        }),

      getById: (id: string) =>
        Effect.gen(function* () {
          const bookmark = yield* storage.get<Bookmark>('bookmarks', id);

          if (!bookmark) {
            return yield* Effect.fail(
              new EntityNotFoundError({
                table: 'bookmarks',
                id,
                message: `Bookmark not found: ${id}`,
              })
            );
          }

          return bookmark;
        }),

      update: (id: string, updates: Partial<Bookmark>) =>
        Effect.gen(function* () {
          const bookmark = yield* storage.get<Bookmark>('bookmarks', id);

          if (!bookmark) {
            return yield* Effect.fail(
              new RepositoryError({
                code: 'NOT_FOUND',
                entity: 'bookmark',
                operation: 'update',
                message: `Bookmark not found: ${id}`,
              })
            );
          }

          const updated = { ...bookmark, ...updates, updatedAt: new Date() };
          yield* storage.put('bookmarks', updated);
          return updated;
        }),

      delete: (id: string) =>
        Effect.gen(function* () {
          const deleted = yield* storage.delete('bookmarks', id);

          if (!deleted) {
            return yield* Effect.fail(
              new RepositoryError({
                code: 'NOT_FOUND',
                entity: 'bookmark',
                operation: 'delete',
                message: `Bookmark not found: ${id}`,
              })
            );
          }
        }),

      getAll: () => storage.getAll<Bookmark>('bookmarks').pipe(
        Effect.mapError(
          (error) =>
            new RepositoryError({
              code: 'UNKNOWN',
              entity: 'bookmark',
              operation: 'query',
              message: 'Failed to get all bookmarks',
              originalError: error,
            })
        )
      ),

      getByStatus: (status: BookmarkStatus) =>
        storage.where<Bookmark>('bookmarks', 'status', 'equals', status).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: 'UNKNOWN',
                entity: 'bookmark',
                operation: 'query',
                message: `Failed to get bookmarks by status: ${status}`,
                originalError: error,
              })
          )
        ),

      bulkCreate: (bookmarks: readonly Bookmark[]) =>
        storage.bulkPut('bookmarks', bookmarks).pipe(
          Effect.mapError(
            (error) =>
              new RepositoryError({
                code: 'UNKNOWN',
                entity: 'bookmark',
                operation: 'create',
                message: 'Failed to bulk create bookmarks',
                originalError: error,
              })
          )
        ),
    };
  })
);

// ============================================================================
// Test Helpers
// ============================================================================

function createMockBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    url: `https://example.com/${crypto.randomUUID()}`,
    title: 'Test Bookmark',
    html: '<html><body>Test content</body></html>',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockMarkdown(bookmarkId: string, overrides: Partial<Markdown> = {}): Markdown {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    bookmarkId,
    content: '# Test Content\n\nThis is test markdown content.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockQA(bookmarkId: string, overrides: Partial<QuestionAnswer> = {}): QuestionAnswer {
  const now = new Date();
  const embedding = Array.from({ length: 1536 }, () => Math.random());
  return {
    id: crypto.randomUUID(),
    bookmarkId,
    question: 'What is this about?',
    answer: 'This is a test answer.',
    embeddingQuestion: embedding,
    embeddingAnswer: embedding,
    embeddingBoth: embedding,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockTag(bookmarkId: string, tagName: string): BookmarkTag {
  return {
    bookmarkId,
    tagName,
    addedAt: new Date(),
  };
}

function createMockJob(overrides: Partial<Job> = {}): Job {
  return {
    id: crypto.randomUUID(),
    type: 'bulk_url_import',
    status: 'pending',
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockJobItem(jobId: string, bookmarkId: string, overrides: Partial<JobItem> = {}): JobItem {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    jobId,
    bookmarkId,
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Database Integration Tests', () => {
  let mockStorage: MockStorage;
  let storageLayer: Layer.Layer<MockStorageService>;
  let repositoryLayer: Layer.Layer<BookmarkRepository, never, MockStorageService>;
  let appLayer: Layer.Layer<BookmarkRepository | MockStorageService>;

  beforeEach(() => {
    mockStorage = new MockStorage();
    storageLayer = createMockStorageLayer(mockStorage);
    repositoryLayer = BookmarkRepositoryLive;
    appLayer = Layer.provide(repositoryLayer, storageLayer);
  });

  describe('Schema Types', () => {
    it('should have correct schema version', () => {
      expect(SCHEMA_VERSION).toBe(5);
    });

    it('should have correct database name', () => {
      expect(DATABASE_NAME).toBe('BookmarkRAG');
    });

    it('should define all table schemas', () => {
      expect(SCHEMA).toHaveLength(8);

      const tableNames = SCHEMA.map((schema) => schema.name);
      expect(tableNames).toContain('bookmarks');
      expect(tableNames).toContain('markdown');
      expect(tableNames).toContain('questionsAnswers');
      expect(tableNames).toContain('settings');
      expect(tableNames).toContain('jobs');
      expect(tableNames).toContain('jobItems');
      expect(tableNames).toContain('bookmarkTags');
      expect(tableNames).toContain('searchHistory');
    });

    it('should have correct primary keys', () => {
      const bookmarkSchema = SCHEMA.find((s) => s.name === 'bookmarks');
      expect(bookmarkSchema?.primaryKey).toBe('id');

      const settingsSchema = SCHEMA.find((s) => s.name === 'settings');
      expect(settingsSchema?.primaryKey).toBe('key');

      const tagsSchema = SCHEMA.find((s) => s.name === 'bookmarkTags');
      expect(tagsSchema?.primaryKey).toEqual(['bookmarkId', 'tagName']);
    });

    it('should have correct indexes', () => {
      const bookmarkSchema = SCHEMA.find((s) => s.name === 'bookmarks');
      expect(bookmarkSchema?.indexes).toContainEqual({ fields: ['url'], unique: true });
      expect(bookmarkSchema?.indexes).toContainEqual({ fields: ['status'] });
      expect(bookmarkSchema?.indexes).toContainEqual({ fields: ['createdAt'] });
    });
  });

  describe('Schema Error Types', () => {
    it('should create SchemaValidationError', () => {
      const error = new SchemaValidationError({
        field: 'url',
        message: 'Invalid URL format',
        value: 'not-a-url',
        expected: 'string (valid URL)',
      });

      expect(error._tag).toBe('SchemaValidationError');
      expect(error.field).toBe('url');
      expect(error.message).toBe('Invalid URL format');
    });

    it('should create DatabaseSchemaError', () => {
      const error = new DatabaseSchemaError({
        operation: 'migration',
        version: 5,
        message: 'Migration failed',
      });

      expect(error._tag).toBe('DatabaseSchemaError');
      expect(error.operation).toBe('migration');
      expect(error.version).toBe(5);
    });

    it('should create ConstraintViolationError', () => {
      const error = new ConstraintViolationError({
        table: 'bookmarks',
        constraint: 'unique',
        field: 'url',
        message: 'URL already exists',
      });

      expect(error._tag).toBe('ConstraintViolationError');
      expect(error.table).toBe('bookmarks');
      expect(error.constraint).toBe('unique');
    });

    it('should create EntityNotFoundError', () => {
      const error = new EntityNotFoundError({
        table: 'bookmarks',
        id: 'test-id',
      });

      expect(error._tag).toBe('EntityNotFoundError');
      expect(error.table).toBe('bookmarks');
      expect(error.id).toBe('test-id');
    });
  });

  describe('Mock Storage Service', () => {
    it('should perform CRUD operations', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Create
        const bookmark = createMockBookmark();
        yield* storage.put('bookmarks', bookmark);

        // Read
        const retrieved = yield* storage.get<Bookmark>('bookmarks', bookmark.id);
        expect(retrieved).toEqual(bookmark);

        // Update
        const updated = { ...bookmark, title: 'Updated Title' };
        yield* storage.put('bookmarks', updated);
        const retrievedUpdated = yield* storage.get<Bookmark>('bookmarks', bookmark.id);
        expect(retrievedUpdated?.title).toBe('Updated Title');

        // Delete
        const deleted = yield* storage.delete('bookmarks', bookmark.id);
        expect(deleted).toBe(true);

        const retrievedDeleted = yield* storage.get<Bookmark>('bookmarks', bookmark.id);
        expect(retrievedDeleted).toBeUndefined();
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should perform bulk operations', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Bulk put
        const bookmarks = [
          createMockBookmark({ title: 'Bookmark 1' }),
          createMockBookmark({ title: 'Bookmark 2' }),
          createMockBookmark({ title: 'Bookmark 3' }),
        ];
        yield* storage.bulkPut('bookmarks', bookmarks);

        // Bulk get
        const ids = bookmarks.map((b) => b.id);
        const retrieved = yield* storage.bulkGet<Bookmark>('bookmarks', ids);

        expect(retrieved).toHaveLength(3);
        expect(retrieved[0]?.title).toBe('Bookmark 1');
        expect(retrieved[1]?.title).toBe('Bookmark 2');
        expect(retrieved[2]?.title).toBe('Bookmark 3');

        // Get all
        const all = yield* storage.getAll<Bookmark>('bookmarks');
        expect(all).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should handle query filters', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Setup test data
        const bookmarks = [
          createMockBookmark({ title: 'Alpha', status: 'complete' }),
          createMockBookmark({ title: 'Beta', status: 'pending' }),
          createMockBookmark({ title: 'Gamma', status: 'complete' }),
          createMockBookmark({ title: 'Delta', status: 'error' }),
        ];
        yield* storage.bulkPut('bookmarks', bookmarks);

        // Test 'eq' operator
        const completeBookmarks = yield* storage.query<Bookmark>('bookmarks', {
          field: 'status',
          operator: 'eq',
          value: 'complete',
        });
        expect(completeBookmarks).toHaveLength(2);

        // Test sorting
        const sortedBookmarks = yield* storage.query<Bookmark>('bookmarks', {
          sort: [{ field: 'title', direction: 'asc' }],
        });
        expect(sortedBookmarks[0].title).toBe('Alpha');
        expect(sortedBookmarks[3].title).toBe('Gamma');

        // Test limit and offset
        const paginatedBookmarks = yield* storage.query<Bookmark>('bookmarks', {
          limit: 2,
          offset: 1,
          sort: [{ field: 'title', direction: 'asc' }],
        });
        expect(paginatedBookmarks).toHaveLength(2);
        expect(paginatedBookmarks[0].title).toBe('Beta');
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should handle where queries', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const bookmarks = [
          createMockBookmark({ status: 'complete' }),
          createMockBookmark({ status: 'pending' }),
          createMockBookmark({ status: 'complete' }),
        ];
        yield* storage.bulkPut('bookmarks', bookmarks);

        // Test 'equals' operator
        const completeBookmarks = yield* storage.where<Bookmark>(
          'bookmarks',
          'status',
          'equals',
          'complete'
        );
        expect(completeBookmarks).toHaveLength(2);

        // Test 'anyOf' operator
        const multipleStatuses = yield* storage.where<Bookmark>(
          'bookmarks',
          'status',
          'anyOf',
          ['complete', 'pending']
        );
        expect(multipleStatuses).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should count items', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const bookmarks = [
          createMockBookmark(),
          createMockBookmark(),
          createMockBookmark(),
        ];
        yield* storage.bulkPut('bookmarks', bookmarks);

        const count = yield* storage.count('bookmarks');
        expect(count).toBe(3);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should reset storage', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        yield* storage.put('bookmarks', createMockBookmark());
        yield* storage.reset();

        const count = yield* storage.count('bookmarks');
        expect(count).toBe(0);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });
  });

  describe('Repository CRUD Operations', () => {
    it('should create a bookmark', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmark = createMockBookmark();
        const created = yield* repo.create(bookmark);

        expect(created).toEqual(bookmark);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should fail to create duplicate URL', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmark1 = createMockBookmark({ url: 'https://example.com/same' });
        const bookmark2 = createMockBookmark({ url: 'https://example.com/same' });

        yield* repo.create(bookmark1);

        const result = yield* Effect.either(repo.create(bookmark2));

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(RepositoryError);
          expect(result.left.code).toBe('CONSTRAINT_VIOLATION');
        } else {
          throw new Error('Expected constraint violation error');
        }
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should get bookmark by id', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmark = createMockBookmark();
        yield* repo.create(bookmark);

        const retrieved = yield* repo.getById(bookmark.id);
        expect(retrieved).toEqual(bookmark);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should fail to get non-existent bookmark', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const result = yield* Effect.either(repo.getById('non-existent'));

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(EntityNotFoundError);
          expect(result.left.table).toBe('bookmarks');
        } else {
          throw new Error('Expected entity not found error');
        }
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should update bookmark', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmark = createMockBookmark({ title: 'Original' });
        yield* repo.create(bookmark);

        const updated = yield* repo.update(bookmark.id, { title: 'Updated' });
        expect(updated.title).toBe('Updated');
        expect(updated.id).toBe(bookmark.id);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should delete bookmark', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmark = createMockBookmark();
        yield* repo.create(bookmark);

        yield* repo.delete(bookmark.id);

        const result = yield* Effect.either(repo.getById(bookmark.id));
        expect(result._tag).toBe('Left');
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should get all bookmarks', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmarks = [
          createMockBookmark(),
          createMockBookmark(),
          createMockBookmark(),
        ];

        for (const bookmark of bookmarks) {
          yield* repo.create(bookmark);
        }

        const all = yield* repo.getAll();
        expect(all).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should get bookmarks by status', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        yield* repo.create(createMockBookmark({ status: 'complete' }));
        yield* repo.create(createMockBookmark({ status: 'pending' }));
        yield* repo.create(createMockBookmark({ status: 'complete' }));

        const completeBookmarks = yield* repo.getByStatus('complete');
        expect(completeBookmarks).toHaveLength(2);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should bulk create bookmarks', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const bookmarks = [
          createMockBookmark(),
          createMockBookmark(),
          createMockBookmark(),
        ];

        yield* repo.bulkCreate(bookmarks);

        const all = yield* repo.getAll();
        expect(all).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });
  });

  describe('Multi-Table Operations', () => {
    it('should store and retrieve bookmark with markdown', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const bookmark = createMockBookmark();
        yield* storage.put('bookmarks', bookmark);

        const markdown = createMockMarkdown(bookmark.id);
        yield* storage.put('markdown', markdown);

        const retrievedBookmark = yield* storage.get<Bookmark>('bookmarks', bookmark.id);
        const retrievedMarkdown = yield* storage.where<Markdown>(
          'markdown',
          'bookmarkId',
          'equals',
          bookmark.id
        );

        expect(retrievedBookmark).toEqual(bookmark);
        expect(retrievedMarkdown).toHaveLength(1);
        expect(retrievedMarkdown[0]).toEqual(markdown);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should store and retrieve bookmark with Q&A pairs', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const bookmark = createMockBookmark();
        yield* storage.put('bookmarks', bookmark);

        const qaPairs = [
          createMockQA(bookmark.id, { question: 'Q1' }),
          createMockQA(bookmark.id, { question: 'Q2' }),
          createMockQA(bookmark.id, { question: 'Q3' }),
        ];
        yield* storage.bulkPut('questionsAnswers', qaPairs);

        const retrievedQAs = yield* storage.where<QuestionAnswer>(
          'questionsAnswers',
          'bookmarkId',
          'equals',
          bookmark.id
        );

        expect(retrievedQAs).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should store and retrieve bookmark with tags', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const bookmark = createMockBookmark();
        yield* storage.put('bookmarks', bookmark);

        const tags = [
          createMockTag(bookmark.id, 'tag1'),
          createMockTag(bookmark.id, 'tag2'),
          createMockTag(bookmark.id, 'tag3'),
        ];

        for (const tag of tags) {
          yield* storage.put(
            'bookmarkTags',
            tag,
            `${tag.bookmarkId}-${tag.tagName}`
          );
        }

        const retrievedTags = yield* storage.where<BookmarkTag>(
          'bookmarkTags',
          'bookmarkId',
          'equals',
          bookmark.id
        );

        expect(retrievedTags).toHaveLength(3);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should batch load tags for multiple bookmarks', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Create bookmarks
        const bookmark1 = createMockBookmark();
        const bookmark2 = createMockBookmark();
        yield* storage.bulkPut('bookmarks', [bookmark1, bookmark2]);

        // Create tags
        const tags = [
          createMockTag(bookmark1.id, 'tag1'),
          createMockTag(bookmark1.id, 'tag2'),
          createMockTag(bookmark2.id, 'tag3'),
        ];

        for (const tag of tags) {
          yield* storage.put(
            'bookmarkTags',
            tag,
            `${tag.bookmarkId}-${tag.tagName}`
          );
        }

        // Batch load tags
        const allTags = yield* storage.where<BookmarkTag>(
          'bookmarkTags',
          'bookmarkId',
          'anyOf',
          [bookmark1.id, bookmark2.id]
        );

        expect(allTags).toHaveLength(3);

        // Group by bookmark
        const tagsByBookmark = new Map<string, BookmarkTag[]>();
        for (const tag of allTags) {
          const existing = tagsByBookmark.get(tag.bookmarkId) ?? [];
          existing.push(tag);
          tagsByBookmark.set(tag.bookmarkId, existing);
        }

        expect(tagsByBookmark.get(bookmark1.id)).toHaveLength(2);
        expect(tagsByBookmark.get(bookmark2.id)).toHaveLength(1);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });
  });

  describe('Job System Operations', () => {
    it('should create and track jobs', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const job = createMockJob({ type: 'bulk_url_import', status: 'pending' });
        yield* storage.put('jobs', job);

        const retrieved = yield* storage.get<Job>('jobs', job.id);
        expect(retrieved).toEqual(job);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should create job items for a job', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const job = createMockJob();
        yield* storage.put('jobs', job);

        const bookmark1 = createMockBookmark();
        const bookmark2 = createMockBookmark();
        yield* storage.bulkPut('bookmarks', [bookmark1, bookmark2]);

        const jobItems = [
          createMockJobItem(job.id, bookmark1.id),
          createMockJobItem(job.id, bookmark2.id),
        ];
        yield* storage.bulkPut('jobItems', jobItems);

        const retrievedItems = yield* storage.where<JobItem>(
          'jobItems',
          'jobId',
          'equals',
          job.id
        );

        expect(retrievedItems).toHaveLength(2);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should query jobs by status', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        const jobs = [
          createMockJob({ status: 'pending' }),
          createMockJob({ status: 'in_progress' }),
          createMockJob({ status: 'completed' }),
          createMockJob({ status: 'pending' }),
        ];
        yield* storage.bulkPut('jobs', jobs);

        const pendingJobs = yield* storage.where<Job>('jobs', 'status', 'equals', 'pending');
        expect(pendingJobs).toHaveLength(2);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Force an error by using invalid table name
        const result = yield* Effect.either(
          storage.get('invalid-table' as TableName, 'test-id')
        );

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(StorageError);
        } else {
          throw new Error('Expected storage error');
        }
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should handle repository errors', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const result = yield* Effect.either(repo.update('non-existent', { title: 'Updated' }));

        if (result._tag === 'Left') {
          expect(result.left).toBeInstanceOf(RepositoryError);
          expect(result.left.code).toBe('NOT_FOUND');
        } else {
          throw new Error('Expected repository error');
        }
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });

    it('should properly type errors in effect chains', async () => {
      const program = Effect.gen(function* () {
        const repo = yield* BookmarkRepository;

        const result = yield* Effect.either(
          Effect.gen(function* () {
            const bookmark = yield* repo.getById('non-existent');
            yield* repo.update(bookmark.id, { title: 'Updated' });
          })
        );

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(
            result.left instanceof EntityNotFoundError ||
            result.left instanceof RepositoryError
          ).toBe(true);
        }
      });

      await Effect.runPromise(Effect.provide(program, appLayer));
    });
  });

  describe('Performance and Batch Operations', () => {
    it('should efficiently bulk load related data', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Create 100 bookmarks
        const bookmarks = Array.from({ length: 100 }, () => createMockBookmark());
        yield* storage.bulkPut('bookmarks', bookmarks);

        // Create 5 Q&A pairs per bookmark
        const qaPairs: QuestionAnswer[] = [];
        for (const bookmark of bookmarks) {
          for (let i = 0; i < 5; i++) {
            qaPairs.push(createMockQA(bookmark.id));
          }
        }
        yield* storage.bulkPut('questionsAnswers', qaPairs);

        // Batch load all Q&A pairs
        const allQAs = yield* storage.getAll<QuestionAnswer>('questionsAnswers');
        expect(allQAs).toHaveLength(500);

        // Verify efficient grouping
        const qaByBookmark = new Map<string, QuestionAnswer[]>();
        for (const qa of allQAs) {
          const existing = qaByBookmark.get(qa.bookmarkId) ?? [];
          existing.push(qa);
          qaByBookmark.set(qa.bookmarkId, existing);
        }

        expect(qaByBookmark.size).toBe(100);
        for (const [_, qas] of qaByBookmark) {
          expect(qas).toHaveLength(5);
        }
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });

    it('should handle large batch operations', async () => {
      const program = Effect.gen(function* () {
        const storage = yield* MockStorageService;

        // Create 1000 bookmarks in a single batch
        const bookmarks = Array.from({ length: 1000 }, () => createMockBookmark());
        yield* storage.bulkPut('bookmarks', bookmarks);

        const count = yield* storage.count('bookmarks');
        expect(count).toBe(1000);

        // Bulk get first 100
        const ids = bookmarks.slice(0, 100).map((b) => b.id);
        const retrieved = yield* storage.bulkGet<Bookmark>('bookmarks', ids);
        expect(retrieved).toHaveLength(100);
        expect(retrieved.every((b) => b !== undefined)).toBe(true);
      });

      await Effect.runPromise(Effect.provide(program, storageLayer));
    });
  });
});
