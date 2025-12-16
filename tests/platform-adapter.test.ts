import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPlatformAdapter, getPlatformAdapter, type PlatformAdapter, type ApiSettings, type Theme } from '../src/lib/platform';

describe('Platform Adapter', () => {
  beforeEach(() => {
    // Reset the adapter before each test
    // We need to access the private adapter variable, so we'll just set a new one
    setPlatformAdapter(null as any);
  });

  it('should throw error when getPlatformAdapter called before setPlatformAdapter', () => {
    expect(() => getPlatformAdapter()).toThrow('Platform adapter not initialized');
  });

  it('should set and get platform adapter', () => {
    const mockAdapter: PlatformAdapter = {
      getSettings: vi.fn(),
      saveSetting: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
    };

    setPlatformAdapter(mockAdapter);
    const adapter = getPlatformAdapter();

    expect(adapter).toBe(mockAdapter);
  });

  it('should allow calling adapter methods after initialization', async () => {
    const mockSettings: ApiSettings = {
      apiBaseUrl: 'https://api.test.com',
      apiKey: 'test-key',
      chatModel: 'test-model',
      embeddingModel: 'test-embedding',
    };

    const mockAdapter: PlatformAdapter = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
      saveSetting: vi.fn().mockResolvedValue(undefined),
      getTheme: vi.fn().mockResolvedValue('dark' as Theme),
      setTheme: vi.fn().mockResolvedValue(undefined),
    };

    setPlatformAdapter(mockAdapter);
    const adapter = getPlatformAdapter();

    const settings = await adapter.getSettings();
    expect(settings).toEqual(mockSettings);
    expect(mockAdapter.getSettings).toHaveBeenCalledTimes(1);

    await adapter.saveSetting('apiKey', 'new-key');
    expect(mockAdapter.saveSetting).toHaveBeenCalledWith('apiKey', 'new-key');

    const theme = await adapter.getTheme();
    expect(theme).toBe('dark');

    await adapter.setTheme('light');
    expect(mockAdapter.setTheme).toHaveBeenCalledWith('light');
  });

  it('should support optional fetchContent method', async () => {
    const mockAdapter: PlatformAdapter = {
      getSettings: vi.fn(),
      saveSetting: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      fetchContent: vi.fn().mockResolvedValue({ html: '<html></html>', finalUrl: 'https://example.com' }),
    };

    setPlatformAdapter(mockAdapter);
    const adapter = getPlatformAdapter();

    if (adapter.fetchContent) {
      const result = await adapter.fetchContent('https://example.com');
      expect(result).toEqual({ html: '<html></html>', finalUrl: 'https://example.com' });
      expect(mockAdapter.fetchContent).toHaveBeenCalledWith('https://example.com');
    }
  });
});
