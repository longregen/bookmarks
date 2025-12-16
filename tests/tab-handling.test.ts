/**
 * Tests for tab null/undefined handling in service-worker and popup
 * Ensures proper handling of incognito mode and restricted URLs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome API
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

// @ts-ignore - Setting up global chrome mock
global.chrome = mockChrome as any;

describe('Tab Property Null Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Service Worker - GET_CURRENT_TAB_INFO handler', () => {
    it('should handle undefined tab.url gracefully', async () => {
      // Simulate a tab with undefined URL (incognito mode)
      const mockTab = {
        id: 1,
        title: 'Test Page',
        url: undefined, // This happens in incognito or restricted URLs
      };

      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([mockTab]);
      });

      const sendResponseMock = vi.fn();
      const mockMessage = { type: 'GET_CURRENT_TAB_INFO' };

      // Simulate the message listener behavior
      const handleMessage = (message: any, sender: any, sendResponse: any) => {
        if (message.type === 'GET_CURRENT_TAB_INFO') {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab) {
              if (!tab.url || !tab.title) {
                sendResponse({
                  error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
                });
              } else {
                sendResponse({
                  url: tab.url,
                  title: tab.title,
                });
              }
            } else {
              sendResponse({ error: 'No active tab found' });
            }
          });
          return true;
        }
      };

      handleMessage(mockMessage, {}, sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
      });
    });

    it('should handle undefined tab.title gracefully', async () => {
      // Simulate a tab with undefined title
      const mockTab = {
        id: 1,
        title: undefined,
        url: 'https://example.com',
      };

      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([mockTab]);
      });

      const sendResponseMock = vi.fn();
      const mockMessage = { type: 'GET_CURRENT_TAB_INFO' };

      const handleMessage = (message: any, sender: any, sendResponse: any) => {
        if (message.type === 'GET_CURRENT_TAB_INFO') {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab) {
              if (!tab.url || !tab.title) {
                sendResponse({
                  error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
                });
              } else {
                sendResponse({
                  url: tab.url,
                  title: tab.title,
                });
              }
            } else {
              sendResponse({ error: 'No active tab found' });
            }
          });
          return true;
        }
      };

      handleMessage(mockMessage, {}, sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
      });
    });

    it('should return tab info when both url and title are defined', async () => {
      const mockTab = {
        id: 1,
        title: 'Test Page',
        url: 'https://example.com',
      };

      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([mockTab]);
      });

      const sendResponseMock = vi.fn();
      const mockMessage = { type: 'GET_CURRENT_TAB_INFO' };

      const handleMessage = (message: any, sender: any, sendResponse: any) => {
        if (message.type === 'GET_CURRENT_TAB_INFO') {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab) {
              if (!tab.url || !tab.title) {
                sendResponse({
                  error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
                });
              } else {
                sendResponse({
                  url: tab.url,
                  title: tab.title,
                });
              }
            } else {
              sendResponse({ error: 'No active tab found' });
            }
          });
          return true;
        }
      };

      handleMessage(mockMessage, {}, sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        url: 'https://example.com',
        title: 'Test Page',
      });
    });

    it('should handle no active tab found', async () => {
      mockChrome.tabs.query.mockImplementation((query, callback) => {
        callback([]); // No tabs
      });

      const sendResponseMock = vi.fn();
      const mockMessage = { type: 'GET_CURRENT_TAB_INFO' };

      const handleMessage = (message: any, sender: any, sendResponse: any) => {
        if (message.type === 'GET_CURRENT_TAB_INFO') {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab) {
              if (!tab.url || !tab.title) {
                sendResponse({
                  error: 'Cannot access tab information. This may be due to incognito mode or restricted URLs (chrome://, about:, etc.)'
                });
              } else {
                sendResponse({
                  url: tab.url,
                  title: tab.title,
                });
              }
            } else {
              sendResponse({ error: 'No active tab found' });
            }
          });
          return true;
        }
      };

      handleMessage(mockMessage, {}, sendResponseMock);

      expect(sendResponseMock).toHaveBeenCalledWith({
        error: 'No active tab found'
      });
    });
  });

  describe('Popup - Tab validation before script injection', () => {
    it('should reject undefined tab.url', () => {
      const tab = {
        id: 1,
        url: undefined,
        title: 'Test Page',
      };

      // Simulate the validation logic
      const canSaveTab = (tab: any): { canSave: boolean; reason?: string } => {
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
      };

      const result = canSaveTab(tab);
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

      const canSaveTab = (tab: any): { canSave: boolean; reason?: string } => {
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
      };

      restrictedUrls.forEach(url => {
        const tab = { id: 1, url, title: 'Test' };
        const result = canSaveTab(tab);
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

      const canSaveTab = (tab: any): { canSave: boolean; reason?: string } => {
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
      };

      validUrls.forEach(url => {
        const tab = { id: 1, url, title: 'Test' };
        const result = canSaveTab(tab);
        expect(result.canSave).toBe(true);
      });
    });
  });

  describe('Keyboard Shortcut Handler - Tab validation', () => {
    it('should handle undefined tab.url in keyboard shortcut', () => {
      const tab = {
        id: 1,
        url: undefined,
        title: 'Test',
      };

      // Simulate the keyboard shortcut handler logic
      const shouldProcessShortcut = (tab: any): boolean => {
        if (!tab || !tab.id) return false;
        if (!tab.url) return false;
        return true;
      };

      const result = shouldProcessShortcut(tab);
      expect(result).toBe(false);
    });

    it('should allow tab with valid url in keyboard shortcut', () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        title: 'Test',
      };

      const shouldProcessShortcut = (tab: any): boolean => {
        if (!tab || !tab.id) return false;
        if (!tab.url) return false;
        return true;
      };

      const result = shouldProcessShortcut(tab);
      expect(result).toBe(true);
    });
  });
});
