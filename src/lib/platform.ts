// Platform-agnostic interface for storage and fetching

export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  // WebDAV fields
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
  webdavEnabled: boolean;
  webdavAllowInsecureHTTP: boolean; // Allow HTTP for local testing (security warning)
  // WebDAV sync state
  webdavSyncInterval: number; // Minutes between auto-sync (0 = disabled)
  webdavLastSyncTime: string; // ISO timestamp
  webdavLastSyncError: string; // Last error message (empty = no error)
}

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

/**
 * Platform adapter interface for abstracting browser extension vs web app differences
 */
export interface PlatformAdapter {
  // Settings management
  getSettings(): Promise<ApiSettings>;
  saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void>;

  // Theme management
  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;

  // Content fetching (optional - only needed for "Add" functionality)
  fetchContent?(url: string): Promise<{ html: string; finalUrl: string }>;
}

// Global adapter instance (set during initialization)
let adapter: PlatformAdapter | null = null;

/**
 * Set the platform adapter for the current environment
 */
export function setPlatformAdapter(a: PlatformAdapter): void {
  adapter = a;
}

/**
 * Get the current platform adapter
 * @throws Error if adapter not initialized
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (!adapter) {
    throw new Error('Platform adapter not initialized. Call setPlatformAdapter() first.');
  }
  return adapter;
}
