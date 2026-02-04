import { getSettings, saveSetting } from './settings';
import { getErrorMessage } from './errors';

// WebAuthn types
export interface PublicKeyCredentialCreationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout?: number;
  excludeCredentials?: { type: 'public-key'; id: string; transports?: string[] }[];
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'discouraged' | 'preferred' | 'required';
    requireResidentKey?: boolean;
    userVerification?: 'discouraged' | 'preferred' | 'required';
  };
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: { type: 'public-key'; id: string; transports?: string[] }[];
  userVerification?: 'discouraged' | 'preferred' | 'required';
}

export interface RegistrationCredentialJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

export interface AuthenticationCredentialJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

// Auth response types
export interface RegisterOptionsResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
  sessionId: string;
}

export interface RegisterVerifyResponse {
  sessionToken: string;
  sessionExpiry: string;
  userId: string;
  username: string;
}

export interface LoginOptionsResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  sessionId: string;
}

export interface LoginVerifyResponse {
  sessionToken: string;
  sessionExpiry: string;
  userId: string;
  username: string;
}

// Bookmark types
export interface CreateBookmarkRequest {
  url: string;
  title: string;
  html: string;
}

export interface ServerBookmark {
  id: string;
  url: string;
  title: string;
  html: string;
  markdown?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  tags: string[];
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

// Search types
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

// Sync types
export interface SyncChange {
  id: string;
  bookmarkId: string;
  changeType: 'create' | 'update' | 'delete';
  bookmark?: ServerBookmark;
  timestamp: string;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  syncToken: string;
  hasMore: boolean;
}

export interface FullSyncRequest {
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

export interface FullSyncResponse {
  created: number;
  updated: number;
  conflicts: { localId: string; serverId: string; resolution: 'local' | 'server' }[];
  syncToken: string;
}

// Error class
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

    let url = `${this.serverUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authenticated && this.sessionToken !== '') {
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
      const errorBody = await response.text();
      let message = `Server error: ${response.status}`;
      let code: string | undefined;

      try {
        const errorJson = JSON.parse(errorBody) as { error?: string; code?: string };
        if (errorJson.error !== undefined && errorJson.error !== '') message = errorJson.error;
        if (errorJson.code !== undefined && errorJson.code !== '') code = errorJson.code;
      } catch {
        if (errorBody !== '') message = errorBody;
      }

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

  // Authentication endpoints

  async getRegisterOptions(username: string): Promise<RegisterOptionsResponse> {
    return this.request<RegisterOptionsResponse>('POST', '/api/v1/auth/register/options', {
      body: { username },
      authenticated: false,
    });
  }

  async verifyRegistration(
    sessionId: string,
    credential: RegistrationCredentialJSON
  ): Promise<RegisterVerifyResponse> {
    const response = await this.request<RegisterVerifyResponse>(
      'POST',
      '/api/v1/auth/register/verify',
      {
        body: { sessionId, credential },
        authenticated: false,
      }
    );

    await this.saveSession(response);
    return response;
  }

  async getLoginOptions(username?: string): Promise<LoginOptionsResponse> {
    return this.request<LoginOptionsResponse>('POST', '/api/v1/auth/login/options', {
      body: username !== undefined && username !== '' ? { username } : {},
      authenticated: false,
    });
  }

  async verifyLogin(
    sessionId: string,
    credential: AuthenticationCredentialJSON
  ): Promise<LoginVerifyResponse> {
    const response = await this.request<LoginVerifyResponse>(
      'POST',
      '/api/v1/auth/login/verify',
      {
        body: { sessionId, credential },
        authenticated: false,
      }
    );

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

  private async saveSession(
    response: RegisterVerifyResponse | LoginVerifyResponse
  ): Promise<void> {
    this.sessionToken = response.sessionToken;
    await saveSetting('serverSessionToken', response.sessionToken);
    await saveSetting('serverSessionExpiry', response.sessionExpiry);
    await saveSetting('serverUsername', response.username);
  }

  private async clearSession(): Promise<void> {
    this.sessionToken = '';
    await saveSetting('serverSessionToken', '');
    await saveSetting('serverSessionExpiry', '');
    await saveSetting('serverUsername', '');
  }

  // Bookmark endpoints

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

  async getBookmark(id: string): Promise<ServerBookmark> {
    return this.request<ServerBookmark>('GET', `/api/v1/bookmarks/${encodeURIComponent(id)}`);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.request<undefined>('DELETE', `/api/v1/bookmarks/${encodeURIComponent(id)}`);
  }

  // Tag endpoints

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

  // Search endpoints

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

  // Sync endpoints

  async getChanges(since?: string): Promise<SyncChangesResponse> {
    return this.request<SyncChangesResponse>('GET', '/api/v1/sync/changes', {
      params: { since },
    });
  }

  async fullSync(request: FullSyncRequest): Promise<FullSyncResponse> {
    return this.request<FullSyncResponse>('POST', '/api/v1/sync/full', {
      body: request,
    });
  }
}
