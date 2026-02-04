// User types
export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

// Bookmark types
export interface Bookmark {
  id: string;
  userId: string;
  url: string;
  title: string;
  html: string | null;
  markdown: string | null;
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: string[];
}

export interface CreateBookmarkRequest {
  url: string;
  title: string;
  html: string;
}

export interface BookmarkListParams {
  page?: number;
  pageSize?: number;
}

export interface BookmarkListResponse {
  bookmarks: Bookmark[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Search types
export interface SearchParams {
  q: string;
  page?: number;
  pageSize?: number;
}

export interface SearchResponse {
  results: Bookmark[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
}

export interface SemanticSearchResult {
  bookmark: Bookmark;
  score: number;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
}

// Sync types
export interface SyncChange {
  id: string;
  bookmarkId: string;
  changeType: 'create' | 'update' | 'delete';
  bookmark?: Bookmark;
  timestamp: string;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  syncToken: string;
  hasMore: boolean;
}

export interface FullSyncBookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  markdown?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface FullSyncRequest {
  bookmarks: FullSyncBookmark[];
}

export interface FullSyncResponse {
  created: number;
  updated: number;
  conflicts: { localId: string; serverId: string; resolution: 'local' | 'server' }[];
  syncToken: string;
}

// WebAuthn types
export interface WebAuthnChallenge {
  sessionId: string;
  challenge: string;
  userId: string | null;
  username: string | null;
  type: 'register' | 'login';
  expiresAt: string;
  createdAt: string;
}

export interface PasskeyCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | null;
  createdAt: string;
}

// Auth response types
export interface AuthResponse {
  sessionToken: string;
  sessionExpiry: string;
  userId: string;
  username: string;
}

// Q&A types
export interface QuestionAnswer {
  id: string;
  bookmarkId: string;
  question: string;
  answer: string;
  embeddingQuestion: Uint8Array | null;
  embeddingAnswer: Uint8Array | null;
  embeddingBoth: Uint8Array | null;
  createdAt: string;
}

// Context type for Hono
export interface AppContext {
  userId: string;
  sessionId: string;
}
