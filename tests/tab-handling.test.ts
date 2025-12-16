import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockChrome = {
  tabs: {
    query: vi.fn(),
  },
  runtime: {
    sendMessage: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn(),
  },
};

// @ts-ignore
global.chrome = mockChrome as any;

function handleTabInfoMessage(sendResponse: (response: any) => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
    const tab = tabs[0];
    if (tab) {
      if (!tab.url || !tab.title) {
        sendResponse({
          error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
        });
      } else {
        sendResponse({ url: tab.url, title: tab.title });
      }
    } else {
      sendResponse({ error: 'No active tab found' });
    }
  });
}

function canSaveTab(tab: any): { canSave: boolean; reason?: string } {
  if (!tab || !tab.id) {
    return { canSave: false, reason: 'No active tab found' };
  }
  if (!tab.url) {
    return { canSave: false, reason: 'Cannot save in incognito mode or restricted URLs' };
  }
  const restrictedSchemes = ['chrome:', 'about:', 'chrome-extension:', 'edge:', 'moz-extension:'];
  if (restrictedSchemes.some(scheme => tab.url?.startsWith(scheme))) {
    return { canSave: false, reason: 'Cannot save browser internal pages' };
  }
  return { canSave: true };
}

function shouldProcessShortcut(tab: any): boolean {
  if (!tab || !tab.id) return false;
  if (!tab.url) return false;
  return true;
}

describe('Tab Property Null Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Service Worker - GET_CURRENT_TAB_INFO handler', () => {
    it('should handle undefined tab.url gracefully', () => {
      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, title: 'Test Page', url: undefined }]);
      });

      const sendResponseMock = vi.fn();
      handleTabInfoMessage(sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
      });
    });

    it('should handle undefined tab.title gracefully', () => {
      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, title: undefined, url: 'https://example.com' }]);
      });

      const sendResponseMock = vi.fn();
      handleTabInfoMessage(sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
      });
    });

    it('should return tab info when both url and title are defined', () => {
      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 1, title: 'Test Page', url: 'https://example.com' }]);
      });

      const sendResponseMock = vi.fn();
      handleTabInfoMessage(sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        url: 'https://example.com',
        title: 'Test Page',
      });
    });

    it('should handle no active tab found', () => {
      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([]);
      });

      const sendResponseMock = vi.fn();
      handleTabInfoMessage(sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({ error: 'No active tab found' });
    });
  });

  describe('Popup - Tab validation before script injection', () => {
    it('should reject undefined tab.url', () => {
      const result = canSaveTab({ id: 1, url: undefined, title: 'Test Page' });
      expect(result.canSave).toBe(false);
      expect(result.reason).toBe('Cannot save in incognito mode or restricted URLs');
    });

    it('should reject restricted URL schemes', () => {
      const restrictedUrls = [
        'chrome://extensions',
        'about:blank',
        'chrome-extension://abc123/page.html',
        'edge://settings',
        'moz-extension://xyz789/page.html',
      ];

      restrictedUrls.forEach(url => {
        const result = canSaveTab({ id: 1, url, title: 'Test' });
        expect(result.canSave).toBe(false);
        expect(result.reason).toBe('Cannot save browser internal pages');
      });
    });

    it('should allow valid HTTP/HTTPS URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://example.com',
        'https://www.example.com/page?query=123',
      ];

      validUrls.forEach(url => {
        const result = canSaveTab({ id: 1, url, title: 'Test' });
        expect(result.canSave).toBe(true);
      });
    });
  });

  describe('Keyboard Shortcut Handler - Tab validation', () => {
    it('should handle undefined tab.url in keyboard shortcut', () => {
      expect(shouldProcessShortcut({ id: 1, url: undefined, title: 'Test' })).toBe(false);
    });

    it('should allow tab with valid url in keyboard shortcut', () => {
      expect(shouldProcessShortcut({ id: 1, url: 'https://example.com', title: 'Test' })).toBe(true);
    });
  });
});
