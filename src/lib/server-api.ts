import { getSettings, saveSetting } from './settings';
import { getErrorMessage } from './errors';

function buildUrlWithParams(baseUrl: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return baseUrl;

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function parseErrorResponse(body: string, status: number): { message: string; code?: string } {
  let message = `Server error: ${status}`;
  let code: string | undefined;

  try {
    const errorJson = JSON.parse(body) as { error?: string; code?: string };
    if (errorJson.error !== undefined && errorJson.error !== '') message = errorJson.error;
    if (errorJson.code !== undefined && errorJson.code !== '') code = errorJson.code;
  } catch {
    if (body !== '') message = body;
  }

  return { message, code };
}

export interface AuthResponse {
  sessionToken: string;
  sessionExpiry: string;
  userId: string;
  created: boolean;
}

export interface CreateBookmarkRequest {
  url: string;
  title: string;
  html?: string;
}

export interface UpdateBookmarkRequest {
  title?: string;
  html?: string;
  tags?: string[];
}

export interface ServerBookmark {
  id: string;
  url: string;
  title: string;
  html: string | null;
  markdown: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: string[];
}

export interface ServerQAPair {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface ServerBookmarkFull extends ServerBookmark {
  qaPairs: ServerQAPair[];
}

export interface BookmarkListResponse {
  bookmarks: ServerBookmark[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface BookmarkListParams {
  page?: number;
  pageSize?: number;
}

export interface SearchParams {
  q: string;
  page?: number;
  pageSize?: number;
}

export interface SearchResponse {
  results: ServerBookmark[];
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
  bookmark: ServerBookmark;
  score: number;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
}

export interface SyncChange {
  type: 'created' | 'updated' | 'deleted';
  bookmark?: ServerBookmark;
  bookmarkId?: string;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  syncTimestamp: string;
}

export interface FullSyncUploadRequest {
  bookmarks: {
    id: string;
    url: string;
    title: string;
    html: string;
    markdown?: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  }[];
}

export interface FullSyncUploadResponse {
  created: number;
  updated: number;
  conflicts: { localId: string; serverId: string; resolution: 'local' | 'server' }[];
  syncToken: string;
}

export interface FullSyncDownloadResponse {
  bookmarks: ServerBookmark[];
  hasMore: boolean;
  total: number;
  syncTimestamp: string;
}

export class ServerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ServerApiError';
  }

  isUnauthorized(): boolean {
    return this.status === 401;
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isConflict(): boolean {
    return this.status === 409;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }
}

export class ServerApiClient {
  private serverUrl: string;
  private sessionToken: string;

  constructor(serverUrl: string, sessionToken: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.sessionToken = sessionToken;
  }

  static async fromSettings(): Promise<ServerApiClient> {
    const settings = await getSettings();
    return new ServerApiClient(settings.serverUrl, settings.serverSessionToken);
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      params?: Record<string, string | number | undefined>;
      authenticated?: boolean;
    } = {}
  ): Promise<T> {
    const { body, params, authenticated = true } = options;
    const url = buildUrlWithParams(`${this.serverUrl}${path}`, params);

    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated && this.sessionToken) {
      headers.Authorization = `Bearer ${this.sessionToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new ServerApiError(`Network error: ${getErrorMessage(error)}`, 0, 'NETWORK_ERROR');
    }

    if (!response.ok) {
      const { message, code } = parseErrorResponse(await response.text(), response.status);
      const error = new ServerApiError(message, response.status, code);
      if (error.isUnauthorized()) {
        await this.handleUnauthorized();
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async handleUnauthorized(): Promise<void> {
    await saveSetting('serverSessionToken', '');
    await saveSetting('serverSessionExpiry', '');
  }

  updateSessionToken(token: string): void {
    this.sessionToken = token;
  }

  getSessionToken(): string {
    return this.sessionToken;
  }

  async checkHealth(): Promise<{ status: string; timestamp: string }> {
    const url = `${this.serverUrl}/health`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new ServerApiError(`Network error: ${getErrorMessage(error)}`, 0, 'NETWORK_ERROR');
    }
    if (!response.ok) {
      throw new ServerApiError(`Server returned ${response.status}`, response.status);
    }
    return (await response.json()) as { status: string; timestamp: string };
  }

  async authenticate(token: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('POST', '/api/v1/auth/token', {
      body: { token },
      authenticated: false,
    });

    await this.saveSession(response);
    return response;
  }

  async logout(): Promise<void> {
    try {
      await this.request<undefined>('POST', '/api/v1/auth/logout');
    } finally {
      await this.clearSession();
    }
  }

  async deleteAccount(): Promise<void> {
    await this.request<undefined>('DELETE', '/api/v1/auth/account');
    await this.clearSession();
  }

  private async saveSession(response: AuthResponse): Promise<void> {
    this.sessionToken = response.sessionToken;
    await saveSetting('serverSessionToken', response.sessionToken);
    await saveSetting('serverSessionExpiry', response.sessionExpiry);
  }

  private async clearSession(): Promise<void> {
    this.sessionToken = '';
    await saveSetting('serverSessionToken', '');
    await saveSetting('serverSessionExpiry', '');
  }

  async createBookmark(bookmark: CreateBookmarkRequest): Promise<ServerBookmark> {
    return this.request<ServerBookmark>('POST', '/api/v1/bookmarks', {
      body: bookmark,
    });
  }

  async listBookmarks(params: BookmarkListParams = {}): Promise<BookmarkListResponse> {
    return this.request<BookmarkListResponse>('GET', '/api/v1/bookmarks', {
      params: {
        page: params.page,
        pageSize: params.pageSize,
      },
    });
  }

  async getBookmarkFull(id: string): Promise<ServerBookmarkFull> {
    return this.request<ServerBookmarkFull>('GET', `/api/v1/bookmarks/${encodeURIComponent(id)}`);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.request<undefined>('DELETE', `/api/v1/bookmarks/${encodeURIComponent(id)}`);
  }

  async updateBookmark(id: string, data: UpdateBookmarkRequest): Promise<ServerBookmark> {
    return this.request<ServerBookmark>('PUT', `/api/v1/bookmarks/${encodeURIComponent(id)}`, {
      body: data,
    });
  }

  async addTag(bookmarkId: string, tag: string): Promise<ServerBookmark> {
    return this.request<ServerBookmark>(
      'POST',
      `/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}/tags`,
      { body: { tag } }
    );
  }

  async removeTag(bookmarkId: string, tag: string): Promise<ServerBookmark> {
    return this.request<ServerBookmark>(
      'DELETE',
      `/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}/tags/${encodeURIComponent(tag)}`
    );
  }

  async reprocessAllBookmarks(): Promise<{ queued: number }> {
    return this.request<{ queued: number }>('POST', '/api/v1/bookmarks/reprocess');
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    return this.request<SearchResponse>('GET', '/api/v1/search', {
      params: {
        q: params.q,
        page: params.page,
        pageSize: params.pageSize,
      },
    });
  }

  async semanticSearch(request: SemanticSearchRequest): Promise<SemanticSearchResponse> {
    return this.request<SemanticSearchResponse>('POST', '/api/v1/search/semantic', {
      body: request,
    });
  }

  async getChanges(since?: string): Promise<SyncChangesResponse> {
    return this.request<SyncChangesResponse>('GET', '/api/v1/sync/changes', {
      params: { since },
    });
  }

  async uploadFullSync(request: FullSyncUploadRequest): Promise<FullSyncUploadResponse> {
    return this.request<FullSyncUploadResponse>('POST', '/api/v1/sync/full', {
      body: request,
    });
  }

  async downloadFullSync(params: { offset?: number; limit?: number } = {}): Promise<FullSyncDownloadResponse> {
    return this.request<FullSyncDownloadResponse>('GET', '/api/v1/sync/full', {
      params: {
        offset: params.offset,
        limit: params.limit,
      },
    });
  }
}
