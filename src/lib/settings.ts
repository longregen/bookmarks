import { getPlatformAdapter, type ApiSettings } from './platform';

export type { ApiSettings } from './platform';

export async function getSettings() {
  return getPlatformAdapter().getSettings();
}

export async function saveSetting(key: keyof ApiSettings, value: string | boolean | number) {
  return getPlatformAdapter().saveSetting(key, value);
}
