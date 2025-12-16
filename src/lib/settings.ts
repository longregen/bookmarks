import { getPlatformAdapter } from './platform';

// Re-export ApiSettings from platform for backward compatibility
export type { ApiSettings } from './platform';

/**
 * Get settings via platform adapter
 * @deprecated Use getPlatformAdapter().getSettings() directly
 */
export async function getSettings() {
  return getPlatformAdapter().getSettings();
}

/**
 * Save a setting via platform adapter
 * @deprecated Use getPlatformAdapter().saveSetting() directly
 */
export async function saveSetting(key: string, value: string | boolean) {
  return getPlatformAdapter().saveSetting(key as any, value);
}
