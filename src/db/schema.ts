import Dexie, { type Table } from 'dexie';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  status: 'fetching' | 'pending' | 'processing' | 'complete' | 'error';
  errorMessage?: string;
  retryCount?: number;
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
  embeddingQuestion: number[];
  embeddingAnswer: number[];
  embeddingBoth: number[];
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
  tagName: string;
  addedAt: Date;
}

export interface SearchHistory {
  id: string;
  query: string;
  resultCount: number;
  createdAt: Date;
}

export enum JobType {
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

export enum JobItemStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETE = 'complete',
  ERROR = 'error'
}

export interface JobItem {
  id: string;
  jobId: string;
  bookmarkId: string;
  status: JobItemStatus;
  retryCount: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  parentJobId?: string;

  metadata: {
    // FILE_IMPORT
    fileName?: string;
    importedCount?: number;
    skippedCount?: number;

    // BULK_URL_IMPORT
    totalUrls?: number;
    successCount?: number;
    failureCount?: number;

    // URL_FETCH
    url?: string;
    bookmarkId?: string;

    // Error info
    errorMessage?: string;
  };

  createdAt: Date;
}

export class BookmarkDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  markdown!: Table<Markdown>;
  questionsAnswers!: Table<QuestionAnswer>;
  settings!: Table<Settings>;
  jobs!: Table<Job>;
  jobItems!: Table<JobItem>;
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

    this.version(4).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });

    this.version(5).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
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

