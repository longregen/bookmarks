import { getPlatformAdapter, type ApiSettings } from './platform';

export type { ApiSettings } from './platform';

export async function getSettings(): Promise<ApiSettings> {
  return getPlatformAdapter().getSettings();
}

export async function saveSetting(key: keyof ApiSettings, value: string | boolean | number): Promise<void> {
  return getPlatformAdapter().saveSetting(key, value);
}
