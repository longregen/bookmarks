import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPlatformAdapter, type PlatformAdapter, type ApiSettings } from '../src/lib/platform';
import { generateQAPairs, generateEmbeddings } from '../src/lib/api';

global.fetch = vi.fn();
(global as any).__DEBUG_EMBEDDINGS__ = false;

describe('API with Platform Adapter', () => {
  const mockSettings: ApiSettings = {
    apiBaseUrl: 'https://api.test.com/v1',
    apiKey: 'test-api-key',
    chatModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
  };

  const mockAdapter: PlatformAdapter = {
    getSettings: vi.fn().mockResolvedValue(mockSettings),
    saveSetting: vi.fn(),
    getTheme: vi.fn(),
    setTheme: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setPlatformAdapter(mockAdapter);
  });

  describe('generateQAPairs', () => {
    it('should call platform adapter to get settings for QA generation', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                pairs: [
                  { question: 'What is this?', answer: 'A test document' }
                ]
              })
            }
          }]
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      await generateQAPairs('# Test Content\n\nThis is a test.');

      expect(mockAdapter.getSettings).toHaveBeenCalled();
    });

    it('should use settings from platform adapter in QA API call', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                pairs: [
                  { question: 'Test?', answer: 'Answer' }
                ]
              })
            }
          }]
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      await generateQAPairs('# Test');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should throw error when API key is not configured for QA generation', async () => {
      const mockAdapterWithoutKey: PlatformAdapter = {
        getSettings: vi.fn().mockResolvedValue({
          ...mockSettings,
          apiKey: '',
        }),
        saveSetting: vi.fn(),
        getTheme: vi.fn(),
        setTheme: vi.fn(),
      };

      setPlatformAdapter(mockAdapterWithoutKey);

      await expect(generateQAPairs('# Test')).rejects.toThrow('API key not configured');
    });
  });

  describe('generateEmbeddings', () => {
    it('should call platform adapter to get settings for embeddings', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: new Array(1536).fill(0.1) }
          ]
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      await generateEmbeddings(['test text']);

      expect(mockAdapter.getSettings).toHaveBeenCalled();
    });

    it('should use settings from platform adapter in embeddings API call', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: new Array(1536).fill(0.1) }
          ]
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      await generateEmbeddings(['test text']);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
          body: expect.stringContaining('"model":"text-embedding-3-small"'),
        })
      );
    });

    it('should throw error when API key is not configured for embeddings', async () => {
      const mockAdapterWithoutKey: PlatformAdapter = {
        getSettings: vi.fn().mockResolvedValue({
          ...mockSettings,
          apiKey: '',
        }),
        saveSetting: vi.fn(),
        getTheme: vi.fn(),
        setTheme: vi.fn(),
      };

      setPlatformAdapter(mockAdapterWithoutKey);

      await expect(generateEmbeddings(['test'])).rejects.toThrow('API key not configured');
    });
  });
});
