import { describe, it, expect } from 'vitest';

function getStatusModifier(status: string): string {
  const statusMap: Record<string, string> = {
    'complete': 'status-dot--success',
    'pending': 'status-dot--warning',
    'fetching': 'status-dot--info',
    'downloaded': 'status-dot--warning',
    'processing': 'status-dot--info',
    'error': 'status-dot--error'
  };
  return statusMap[status] || 'status-dot--warning';
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

describe('Library helpers', () => {
  describe('getStatusModifier', () => {
    it('should map complete to success', () => {
      expect(getStatusModifier('complete')).toBe('status-dot--success');
    });

    it('should map pending to warning', () => {
      expect(getStatusModifier('pending')).toBe('status-dot--warning');
    });

    it('should map fetching to info', () => {
      expect(getStatusModifier('fetching')).toBe('status-dot--info');
    });

    it('should map downloaded to warning', () => {
      expect(getStatusModifier('downloaded')).toBe('status-dot--warning');
    });

    it('should map processing to info', () => {
      expect(getStatusModifier('processing')).toBe('status-dot--info');
    });

    it('should map error to error', () => {
      expect(getStatusModifier('error')).toBe('status-dot--error');
    });

    it('should fall back to warning for unknown statuses', () => {
      expect(getStatusModifier('unknown')).toBe('status-dot--warning');
      expect(getStatusModifier('')).toBe('status-dot--warning');
    });

    it('should cover all bookmark statuses', () => {
      const allStatuses = ['fetching', 'downloaded', 'pending', 'processing', 'complete', 'error'];
      for (const status of allStatuses) {
        expect(getStatusModifier(status)).toBeDefined();
        expect(getStatusModifier(status)).not.toBe('');
      }
    });
  });

  describe('getHostname (URL parsing)', () => {
    it('should extract hostname from valid URL', () => {
      expect(getHostname('https://example.com/path')).toBe('example.com');
    });

    it('should extract hostname from URL with port', () => {
      expect(getHostname('http://localhost:3000/test')).toBe('localhost');
    });

    it('should extract hostname from URL with subdomain', () => {
      expect(getHostname('https://docs.github.com/en/pages')).toBe('docs.github.com');
    });

    it('should return raw string for malformed URL', () => {
      expect(getHostname('not-a-url')).toBe('not-a-url');
    });

    it('should return raw string for empty string', () => {
      expect(getHostname('')).toBe('');
    });

    it('should return raw string for relative path', () => {
      expect(getHostname('/some/path')).toBe('/some/path');
    });

    it('should handle URL with special characters', () => {
      expect(getHostname('https://example.com/path?q=hello&foo=bar')).toBe('example.com');
    });
  });
});
