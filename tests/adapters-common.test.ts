import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/schema';
import { getSettingsFromDb, saveSettingToDb, DEFAULTS } from '../src/lib/adapters/common';

describe('Adapters Common', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  describe('DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(DEFAULTS.apiKey).toBe('');
      expect(DEFAULTS.chatModel).toBe('gpt-4o-mini');
      expect(DEFAULTS.embeddingModel).toBe('text-embedding-3-small');
      expect(DEFAULTS.webdavPath).toBe('/bookmarks');
      expect(DEFAULTS.webdavEnabled).toBe(false);
      expect(DEFAULTS.webdavAllowInsecure).toBe(false);
      expect(DEFAULTS.webdavSyncInterval).toBe(15);
      expect(DEFAULTS.webdavLastSyncTime).toBe('');
      expect(DEFAULTS.webdavLastSyncError).toBe('');
    });

    it('should have default API base URL', () => {
      expect(DEFAULTS.apiBaseUrl).toBeDefined();
      expect(typeof DEFAULTS.apiBaseUrl).toBe('string');
    });
  });

  describe('getSettingsFromDb', () => {
    it('should return defaults when no settings exist', async () => {
      const settings = await getSettingsFromDb();

      expect(settings.apiKey).toBe(DEFAULTS.apiKey);
      expect(settings.chatModel).toBe(DEFAULTS.chatModel);
      expect(settings.embeddingModel).toBe(DEFAULTS.embeddingModel);
      expect(settings.webdavEnabled).toBe(DEFAULTS.webdavEnabled);
    });

    it('should return stored settings when they exist', async () => {
      const now = new Date();
      await db.settings.add({ key: 'apiKey', value: 'test-api-key', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'chatModel', value: 'gpt-4', createdAt: now, updatedAt: now });

      const settings = await getSettingsFromDb();

      expect(settings.apiKey).toBe('test-api-key');
      expect(settings.chatModel).toBe('gpt-4');
      expect(settings.embeddingModel).toBe(DEFAULTS.embeddingModel);
    });

    it('should handle boolean settings', async () => {
      const now = new Date();
      await db.settings.add({ key: 'webdavEnabled', value: true, createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavAllowInsecure', value: true, createdAt: now, updatedAt: now });

      const settings = await getSettingsFromDb();

      expect(settings.webdavEnabled).toBe(true);
      expect(settings.webdavAllowInsecure).toBe(true);
    });

    it('should handle number settings', async () => {
      const now = new Date();
      await db.settings.add({ key: 'webdavSyncInterval', value: 30, createdAt: now, updatedAt: now });

      const settings = await getSettingsFromDb();

      expect(settings.webdavSyncInterval).toBe(30);
    });

    it('should handle all WebDAV settings', async () => {
      const now = new Date();
      await db.settings.add({ key: 'webdavUrl', value: 'https://webdav.example.com', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavUsername', value: 'user123', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavPassword', value: 'secret', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavPath', value: '/my/bookmarks', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavLastSyncTime', value: '2024-01-15T12:00:00Z', createdAt: now, updatedAt: now });
      await db.settings.add({ key: 'webdavLastSyncError', value: 'Connection failed', createdAt: now, updatedAt: now });

      const settings = await getSettingsFromDb();

      expect(settings.webdavUrl).toBe('https://webdav.example.com');
      expect(settings.webdavUsername).toBe('user123');
      expect(settings.webdavPassword).toBe('secret');
      expect(settings.webdavPath).toBe('/my/bookmarks');
      expect(settings.webdavLastSyncTime).toBe('2024-01-15T12:00:00Z');
      expect(settings.webdavLastSyncError).toBe('Connection failed');
    });
  });

  describe('saveSettingToDb', () => {
    it('should save a new string setting', async () => {
      await saveSettingToDb('apiKey', 'new-api-key');

      const rows = await db.settings.toArray();
      const apiKeySetting = rows.find(r => r.key === 'apiKey');

      expect(apiKeySetting).toBeDefined();
      expect(apiKeySetting?.value).toBe('new-api-key');
    });

    it('should save a new boolean setting', async () => {
      await saveSettingToDb('webdavEnabled', true);

      const rows = await db.settings.toArray();
      const setting = rows.find(r => r.key === 'webdavEnabled');

      expect(setting).toBeDefined();
      expect(setting?.value).toBe(true);
    });

    it('should save a new number setting', async () => {
      await saveSettingToDb('webdavSyncInterval', 60);

      const rows = await db.settings.toArray();
      const setting = rows.find(r => r.key === 'webdavSyncInterval');

      expect(setting).toBeDefined();
      expect(setting?.value).toBe(60);
    });

    it('should update an existing setting', async () => {
      const now = new Date();
      await db.settings.add({ key: 'apiKey', value: 'old-key', createdAt: now, updatedAt: now });

      await saveSettingToDb('apiKey', 'new-key');

      const rows = await db.settings.toArray();
      const apiKeySettings = rows.filter(r => r.key === 'apiKey');

      expect(apiKeySettings).toHaveLength(1);
      expect(apiKeySettings[0].value).toBe('new-key');
    });

    it('should set createdAt and updatedAt for new settings', async () => {
      const beforeSave = new Date();
      await saveSettingToDb('apiKey', 'test-key');
      const afterSave = new Date();

      const setting = await db.settings.get('apiKey');

      expect(setting?.createdAt).toBeDefined();
      expect(setting?.updatedAt).toBeDefined();
      expect(setting?.createdAt.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
      expect(setting?.updatedAt.getTime()).toBeLessThanOrEqual(afterSave.getTime());
    });

    it('should update updatedAt when updating a setting', async () => {
      const originalDate = new Date('2024-01-01T00:00:00Z');
      await db.settings.add({ key: 'apiKey', value: 'old-key', createdAt: originalDate, updatedAt: originalDate });

      const beforeUpdate = new Date();
      await saveSettingToDb('apiKey', 'new-key');

      const setting = await db.settings.get('apiKey');

      expect(setting?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });

    it('should handle saving multiple settings', async () => {
      await saveSettingToDb('apiKey', 'key-1');
      await saveSettingToDb('chatModel', 'gpt-4');
      await saveSettingToDb('webdavEnabled', true);
      await saveSettingToDb('webdavSyncInterval', 30);

      const settings = await getSettingsFromDb();

      expect(settings.apiKey).toBe('key-1');
      expect(settings.chatModel).toBe('gpt-4');
      expect(settings.webdavEnabled).toBe(true);
      expect(settings.webdavSyncInterval).toBe(30);
    });

    it('should handle empty string values', async () => {
      await saveSettingToDb('apiKey', '');

      const setting = await db.settings.get('apiKey');
      expect(setting?.value).toBe('');
    });

    it('should handle false boolean values', async () => {
      await saveSettingToDb('webdavEnabled', true);
      expect((await db.settings.get('webdavEnabled'))?.value).toBe(true);

      await saveSettingToDb('webdavEnabled', false);
      expect((await db.settings.get('webdavEnabled'))?.value).toBe(false);
    });

    it('should handle zero numeric values', async () => {
      await saveSettingToDb('webdavSyncInterval', 0);

      const setting = await db.settings.get('webdavSyncInterval');
      expect(setting?.value).toBe(0);
    });
  });

  describe('Integration: getSettingsFromDb and saveSettingToDb', () => {
    it('should round-trip settings correctly', async () => {
      await saveSettingToDb('apiKey', 'test-key');
      await saveSettingToDb('apiBaseUrl', 'https://api.custom.com');
      await saveSettingToDb('chatModel', 'gpt-4-turbo');
      await saveSettingToDb('embeddingModel', 'text-embedding-ada-002');
      await saveSettingToDb('webdavEnabled', true);
      await saveSettingToDb('webdavSyncInterval', 45);

      const settings = await getSettingsFromDb();

      expect(settings.apiKey).toBe('test-key');
      expect(settings.apiBaseUrl).toBe('https://api.custom.com');
      expect(settings.chatModel).toBe('gpt-4-turbo');
      expect(settings.embeddingModel).toBe('text-embedding-ada-002');
      expect(settings.webdavEnabled).toBe(true);
      expect(settings.webdavSyncInterval).toBe(45);
    });
  });
});
