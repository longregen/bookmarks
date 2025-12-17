export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavPath: string;
  webdavEnabled: boolean;
  webdavAllowInsecure: boolean;
  webdavSyncInterval: number;
  webdavLastSyncTime: string;
  webdavLastSyncError: string;
}

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

export interface PlatformAdapter {
  getSettings(): Promise<ApiSettings>;
  saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void>;

  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;

  fetchContent?(url: string): Promise<{ html: string; finalUrl: string }>;
}

let adapter: PlatformAdapter | null = null;

export function setPlatformAdapter(a: PlatformAdapter): void {
  adapter = a;
}

export function getPlatformAdapter(): PlatformAdapter {
  if (!adapter) {
    throw new Error('Platform adapter not initialized. Call setPlatformAdapter() first.');
  }
  return adapter;
}
