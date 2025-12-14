import Dexie, { Table } from 'dexie';

export interface Bookmark {
  id: string;                  // crypto.randomUUID()
  url: string;
  title: string;
  html: string;                // full document.documentElement.outerHTML
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage?: string;
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

export class BookmarkDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  markdown!: Table<Markdown>;
  questionsAnswers!: Table<QuestionAnswer>;
  settings!: Table<Settings>;

  constructor() {
    super('BookmarkRAG');

    this.version(1).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
    });
  }
}

export const db = new BookmarkDatabase();
