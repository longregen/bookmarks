import { getPlatformAdapter, type ApiSettings } from './platform';

export type { ApiSettings };

export function getSettings(): Promise<ApiSettings> {
  return getPlatformAdapter().getSettings();
}

export function saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
  return getPlatformAdapter().saveSetting(key, value);
}
