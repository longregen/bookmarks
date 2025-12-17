import Dexie, { type Table } from 'dexie';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage?: string;
  errorStack?: string;
  retryCount?: number;
  lastRetryAt?: Date;
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Markdown {
  id: string;
  bookmarkId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionAnswer {
  id: string;
  bookmarkId: string;
  question: string;
  answer: string;
  embeddingQuestion: number[]; // Float array, 1536 dims for text-embedding-3-small
  embeddingAnswer: number[];
  embeddingBoth: number[];     // embedding of "Q: {question}\nA: {answer}"
  createdAt: Date;
  updatedAt: Date;
}

export interface Settings {
  key: string;
  value: unknown;
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
  id: string;
  type: JobType;
  status: JobStatus;
  parentJobId?: string;          // For hierarchical jobs (e.g., bulk import -> individual fetches)
  bookmarkId?: string;

  progress: number;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;

  metadata: {
    characterCount?: number;
    wordCount?: number;
    extractionTimeMs?: number;

    pairsGenerated?: number;
    truncatedChars?: number;
    apiTimeMs?: number;
    embeddingTimeMs?: number;

    fileName?: string;
    totalBookmarks?: number;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    errors?: { url: string; error: string }[];

    totalUrls?: number;
    successCount?: number;
    failureCount?: number;

    url?: string;
    fetchTimeMs?: number;
    htmlSize?: number;
    bookmarkId?: string;

    title?: string;
    captureTimeMs?: number;
    source?: string;

    errorMessage?: string;
    errorStack?: string;
    retryCount?: number;

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

    this.version(2).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]',
    }).upgrade(() => {
      console.log('Upgraded database to version 2 with jobs table');
    });

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

export async function getBookmarkContent(bookmarkId: string): Promise<{
  markdown: Markdown | undefined;
  qaPairs: QuestionAnswer[];
  tags: BookmarkTag[];
}> {
  const [markdown, qaPairs, tags] = await Promise.all([
    db.markdown.where('bookmarkId').equals(bookmarkId).first(),
    db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray(),
    db.bookmarkTags.where('bookmarkId').equals(bookmarkId).toArray(),
  ]);
  return { markdown, qaPairs, tags };
}

export async function getBookmarkMarkdown(bookmarkId: string): Promise<Markdown | undefined> {
  return db.markdown.where('bookmarkId').equals(bookmarkId).first();
}

export async function getBookmarkQAPairs(bookmarkId: string): Promise<QuestionAnswer[]> {
  return db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();
}

export async function getBookmarkTags(bookmarkId: string): Promise<BookmarkTag[]> {
  return db.bookmarkTags.where('bookmarkId').equals(bookmarkId).toArray();
}

export async function getFullBookmark(bookmarkId: string): Promise<{
  bookmark: Bookmark | undefined;
  markdown: Markdown | undefined;
  qaPairs: QuestionAnswer[];
  tags: BookmarkTag[];
} | null> {
  const [bookmark, markdown, qaPairs, tags] = await Promise.all([
    db.bookmarks.get(bookmarkId),
    db.markdown.where('bookmarkId').equals(bookmarkId).first(),
    db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray(),
    db.bookmarkTags.where('bookmarkId').equals(bookmarkId).toArray(),
  ]);

  if (!bookmark) {
    return null;
  }

  return { bookmark, markdown, qaPairs, tags };
}
