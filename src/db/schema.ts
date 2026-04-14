import Dexie, { type Table } from 'dexie';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  status: 'fetching' | 'downloaded' | 'pending' | 'processing' | 'complete' | 'error';
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
  lastAccessedAt?: Date;
  sizeBytes?: number;
}

export interface QuestionAnswer {
  id: string;
  bookmarkId: string;
  question: string;
  answer: string;
  embeddingQuestion: number[];
  embeddingAnswer: number[];
  embeddingBoth: number[];
  embeddingModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Summary {
  id: string;
  bookmarkId: string;
  content: string;
  embedding: number[];
  embeddingModel?: string;
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
  URL_FETCH = 'url_fetch',
  SYNC_UPLOAD = 'sync_upload',
  SELF_HEAL = 'self_heal'
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
    fileName?: string;
    importedCount?: number;
    skippedCount?: number;
    totalUrls?: number;
    successCount?: number;
    failureCount?: number;
    url?: string;
    bookmarkId?: string;
    errorMessage?: string;
  };

  createdAt: Date;
}

function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function applyMarkdownV8Upgrade(tx: { table: (name: string) => { toCollection: () => { modify: (fn: (md: Markdown) => void) => Promise<unknown> } } }): Promise<void> {
  await tx.table('markdown').toCollection().modify((md: Markdown) => {
    // Coerce into a real Date — pre-v2 rows and some JSON-import paths stored
    // dates as ISO strings, and a non-Date value breaks orderBy on the new
    // lastAccessedAt index. The interface says these are always Date; this
    // migration is where we enforce that invariant on existing data.
    if (!(md.lastAccessedAt instanceof Date)) {
      md.lastAccessedAt = toDate(md.lastAccessedAt)
        ?? toDate(md.updatedAt)
        ?? toDate(md.createdAt)
        ?? new Date(0);
    }
    if (typeof md.sizeBytes !== 'number') {
      md.sizeBytes = md.content.length * 2;
    }
  });
}

export class BookmarkDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  markdown!: Table<Markdown>;
  questionsAnswers!: Table<QuestionAnswer>;
  summaries!: Table<Summary>;
  settings!: Table<Settings>;
  jobs!: Table<Job>;
  jobItems!: Table<JobItem>;
  bookmarkTags!: Table<BookmarkTag>;
  searchHistory!: Table<SearchHistory>;

  constructor(name = 'BookmarkRAG') {
    super(name);

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

    this.version(6).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt, [status+updatedAt]',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });

    this.version(7).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt, [status+updatedAt]',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      summaries: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    });

    this.version(8).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt, [status+updatedAt]',
      markdown: 'id, bookmarkId, createdAt, updatedAt, lastAccessedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      summaries: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
      jobs: 'id, parentJobId, status, type, createdAt',
      jobItems: 'id, jobId, bookmarkId, status, createdAt, updatedAt, [jobId+status]',
      bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
      searchHistory: 'id, query, createdAt',
    }).upgrade(applyMarkdownV8Upgrade);
  }
}

export const db = new BookmarkDatabase();

export async function getBookmarkContent(bookmarkId: string): Promise<{
  markdown: Markdown | undefined;
  qaPairs: QuestionAnswer[];
}> {
  const [markdown, qaPairs] = await Promise.all([
    db.markdown.where('bookmarkId').equals(bookmarkId).first(),
    db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray(),
  ]);
  if (markdown) {
    void import('../lib/content-tier').then(m => m.touchMarkdown(bookmarkId)).catch(() => { /* best-effort */ });
  }
  return { markdown, qaPairs };
}

