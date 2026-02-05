import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';
import {
  setConfigValue,
  getConfigValue,
  resetConfigValue,
  resetAllConfigValues,
  loadConfigOverrides,
  saveConfigOverrides,
  isConfigModified,
  getAllConfigEntries,
  searchConfigEntries,
  getModifiedCount,
  CONFIG_REGISTRY,
} from '../src/lib/config-registry';

describe('config-registry', () => {
  beforeEach(async () => {
    await resetAllConfigValues();
    await db.settings.clear();
  });

  describe('setConfigValue', () => {
    it('should accept string values for textarea config entries', async () => {
      await setConfigValue('QA_SYSTEM_PROMPT', 'custom prompt');
      expect(getConfigValue('QA_SYSTEM_PROMPT')).toBe('custom prompt');
    });

    it('should accept string values for string config entries', async () => {
      await setConfigValue('DEFAULT_API_BASE_URL', 'https://example.com');
      expect(getConfigValue('DEFAULT_API_BASE_URL')).toBe('https://example.com');
    });

    it('should accept number values for number config entries', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 10);
      expect(getConfigValue('FETCH_CONCURRENCY')).toBe(10);
    });

    it('should accept boolean values for boolean config entries', async () => {
      await setConfigValue('API_CHAT_USE_TEMPERATURE', false);
      expect(getConfigValue('API_CHAT_USE_TEMPERATURE')).toBe(false);
    });

    it('should reject number values for textarea config entries', async () => {
      await expect(setConfigValue('QA_SYSTEM_PROMPT', 42)).rejects.toThrow(
        'Invalid type for QA_SYSTEM_PROMPT: expected textarea, got number'
      );
    });

    it('should reject string values for number config entries', async () => {
      await expect(setConfigValue('FETCH_CONCURRENCY', 'bad' as any)).rejects.toThrow(
        'Invalid type for FETCH_CONCURRENCY: expected number, got string'
      );
    });

    it('should reject values below min', async () => {
      await expect(setConfigValue('FETCH_CONCURRENCY', 0)).rejects.toThrow(
        'Value for FETCH_CONCURRENCY must be at least 1'
      );
    });

    it('should reject values above max', async () => {
      await expect(setConfigValue('FETCH_CONCURRENCY', 100)).rejects.toThrow(
        'Value for FETCH_CONCURRENCY must be at most 50'
      );
    });

    it('should throw for unknown config keys', async () => {
      await expect(setConfigValue('UNKNOWN_KEY', 42)).rejects.toThrow(
        'Unknown config key: UNKNOWN_KEY'
      );
    });
  });

  describe('saveConfigOverrides', () => {
    it('should preserve createdAt on subsequent saves', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 10);

      const afterFirstSave = await db.settings.get('advancedConfig');
      const firstCreatedAt = afterFirstSave!.createdAt;

      await new Promise(resolve => setTimeout(resolve, 10));

      await setConfigValue('FETCH_CONCURRENCY', 20);

      const afterSecondSave = await db.settings.get('advancedConfig');
      expect(afterSecondSave!.createdAt.getTime()).toBe(firstCreatedAt.getTime());
      expect(afterSecondSave!.updatedAt.getTime()).toBeGreaterThanOrEqual(firstCreatedAt.getTime());
    });

    it('should set createdAt to now on first save', async () => {
      const before = new Date();
      await setConfigValue('FETCH_CONCURRENCY', 10);
      const after = new Date();

      const record = await db.settings.get('advancedConfig');
      expect(record!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(record!.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getConfigValue', () => {
    it('should return default value when no override is set', () => {
      expect(getConfigValue('FETCH_CONCURRENCY')).toBe(5);
    });

    it('should throw for unknown keys', () => {
      expect(() => getConfigValue('UNKNOWN_KEY')).toThrow('Unknown config key: UNKNOWN_KEY');
    });
  });

  describe('resetConfigValue', () => {
    it('should restore the default value', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 10);
      expect(getConfigValue('FETCH_CONCURRENCY')).toBe(10);

      await resetConfigValue('FETCH_CONCURRENCY');
      expect(getConfigValue('FETCH_CONCURRENCY')).toBe(5);
    });

    it('should throw for unknown keys', async () => {
      await expect(resetConfigValue('UNKNOWN_KEY')).rejects.toThrow(
        'Unknown config key: UNKNOWN_KEY'
      );
    });
  });

  describe('isConfigModified', () => {
    it('should return false for unmodified keys', () => {
      expect(isConfigModified('FETCH_CONCURRENCY')).toBe(false);
    });

    it('should return true for modified keys', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 10);
      expect(isConfigModified('FETCH_CONCURRENCY')).toBe(true);
    });
  });

  describe('getModifiedCount', () => {
    it('should return 0 when no overrides are set', () => {
      expect(getModifiedCount()).toBe(0);
    });

    it('should count modified keys', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 10);
      await setConfigValue('STUMBLE_COUNT', 5);
      expect(getModifiedCount()).toBe(2);
    });
  });

  describe('getAllConfigEntries', () => {
    it('should return all registry entries with current values', () => {
      const entries = getAllConfigEntries();
      expect(entries.length).toBe(CONFIG_REGISTRY.length);
      expect(entries[0]).toHaveProperty('currentValue');
      expect(entries[0]).toHaveProperty('isModified');
    });
  });

  describe('searchConfigEntries', () => {
    it('should filter entries by key', () => {
      const results = searchConfigEntries('FETCH');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(e => e.key.includes('FETCH'))).toBe(true);
    });

    it('should filter entries by description (case-insensitive)', () => {
      const results = searchConfigEntries('timeout');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty for no matches', () => {
      const results = searchConfigEntries('zzz_nonexistent_zzz');
      expect(results).toHaveLength(0);
    });
  });

  describe('loadConfigOverrides', () => {
    it('should load previously saved overrides', async () => {
      await setConfigValue('FETCH_CONCURRENCY', 42);

      const saved = await db.settings.get('advancedConfig');
      expect((saved!.value as Record<string, unknown>)['FETCH_CONCURRENCY']).toBe(42);

      await loadConfigOverrides();
      expect(getConfigValue('FETCH_CONCURRENCY')).toBe(42);
    });
  });
});
