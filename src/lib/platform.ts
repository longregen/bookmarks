export type ContentTier = 'full' | 'summaries' | 'titles';

export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  serverUrl: string;
  serverEnabled: boolean;
  serverSessionToken: string;
  serverSessionExpiry: string;
  serverAuthToken: string;
  serverLastSyncTime: string;
  serverLastSyncError: string;
  contentTier: ContentTier;
  markdownCacheCapMB: number;
  markdownCacheBytes: number;
  contentTierMigrationAt: string;
}

export type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

export interface PlatformAdapter {
  getSettings(): Promise<ApiSettings>;
  saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void>;

  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;

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
