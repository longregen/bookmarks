import Dexie, { Table } from 'dexie';

export interface Bookmark {
  id: string;                  // crypto.randomUUID()
  url: string;
  title: string;
  html: string;                // full document.documentElement.outerHTML
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage?: string;
  errorStack?: string;         // Stack trace for debugging
  retryCount?: number;         // Number of retry attempts (for error recovery)
  lastRetryAt?: Date;          // Timestamp of last retry attempt
  nextRetryAt?: Date;          // Timestamp when next retry should occur (exponential backoff)
  createdAt: Date;
  updatedAt: Date;
}

export interface Markdown {
  id: string;                  // crypto.randomUUID()
  bookmarkId: string;          // foreign key → Bookmark.id
  content: string;             // Readability output converted to Markdown
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionAnswer {
  id: string;                  // crypto.randomUUID()
  bookmarkId: string;          // foreign key → Bookmark.id
  question: string;
  answer: string;
  embeddingQuestion: number[]; // Float array, 1536 dims for text-embedding-3-small
  embeddingAnswer: number[];
  embeddingBoth: number[];     // embedding of "Q: {question}\nA: {answer}"
  createdAt: Date;
  updatedAt: Date;
}

export interface Settings {
  key: string;                 // primary key, e.g., 'api'
  value: any;                  // JSON-serializable value
  createdAt: Date;
  updatedAt: Date;
}

export interface BookmarkTag {
  bookmarkId: string;
  tagName: string;             // Lowercase, hyphens for spaces
  addedAt: Date;
}

export interface SearchHistory {
  id: string;
  query: string;
  resultCount: number;
  createdAt: Date;
}

export enum JobType {
  MANUAL_ADD = 'manual_add',
  MARKDOWN_GENERATION = 'markdown_generation',
  QA_GENERATION = 'qa_generation',
  FILE_IMPORT = 'file_import',
  BULK_URL_IMPORT = 'bulk_url_import',
  URL_FETCH = 'url_fetch'
}

export enum JobStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface Job {
  id: string;                    // UUID
  type: JobType;
  status: JobStatus;
  parentJobId?: string;          // For hierarchical jobs (e.g., bulk import -> individual fetches)
  bookmarkId?: string;           // Associated bookmark (if applicable)

  // Progress tracking
  progress: number;              // 0-100
  currentStep?: string;          // Human-readable current step
  totalSteps?: number;           // For multi-step operations
  completedSteps?: number;       // Completed steps count

  // Metadata (flexible JSON)
  metadata: {
    // For MARKDOWN_GENERATION
    characterCount?: number;
    wordCount?: number;
    extractionTimeMs?: number;

    // For QA_GENERATION
    pairsGenerated?: number;
    truncatedChars?: number;
    apiTimeMs?: number;
    embeddingTimeMs?: number;

    // For FILE_IMPORT
    fileName?: string;
    totalBookmarks?: number;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    errors?: Array<{ url: string; error: string }>;

    // For BULK_URL_IMPORT
    totalUrls?: number;
    successCount?: number;
    failureCount?: number;

    // For URL_FETCH
    url?: string;
    fetchTimeMs?: number;
    htmlSize?: number;
    bookmarkId?: string;

    // For MANUAL_ADD
    title?: string;
    captureTimeMs?: number;
    source?: string;

    // Common
    errorMessage?: string;
    errorStack?: string;
    retryCount?: number;

    // Job resumption tracking
    lastInterruptedAt?: string;
    resumedAt?: string;
    resumedAndCompleted?: boolean;
  };

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export class BookmarkDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  markdown!: Table<Markdown>;
  questionsAnswers!: Table<QuestionAnswer>;
  settings!: Table<Settings>;
  jobs!: Table<Job>;
  bookmarkTags!: Table<BookmarkTag>;
  searchHistory!: Table<SearchHistory>;

  constructor() {
    super('BookmarkRAG');

    this.version(1).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
    });

    // Version 2: Add jobs table
    this.version(2).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]',
    }).upgrade(async () => {
      console.log('Upgraded database to version 2 with jobs table');
    });

    // Version 3: Add bookmarkTags table for the redesigned tag system and searchHistory table for search autocomplete
    this.version(3).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });
  }
}

export const db = new BookmarkDatabase();
