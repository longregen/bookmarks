import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import {
  validateUrls,
  validateSingleUrl,
  createBulkImportJob,
  extractTitleFromHtml,
} from '../src/lib/bulk-import';

describe('Bulk Import Library', () => {
  beforeEach(async () => {
    await db.jobs.clear();
    await db.bookmarks.clear();
  });

  afterEach(async () => {
    await db.jobs.clear();
    await db.bookmarks.clear();
  });

  describe('validateSingleUrl', () => {
    it('should validate a valid HTTP URL', () => {
      const result = validateSingleUrl('http://example.com');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('http://example.com/');
      expect(result.error).toBeUndefined();
    });

    it('should validate a valid HTTPS URL', () => {
      const result = validateSingleUrl('https://example.com');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('https://example.com/');
      expect(result.error).toBeUndefined();
    });

    it('should add https:// to URLs without protocol', () => {
      const result = validateSingleUrl('example.com');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('https://example.com/');
    });

    it('should reject javascript: URLs', () => {
      const result = validateSingleUrl('javascript:alert(1)');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('JavaScript URLs are not allowed');
    });

    it('should reject data: URLs', () => {
      const result = validateSingleUrl('data:text/html,<h1>Test</h1>');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Data URLs are not allowed');
    });

    it('should reject file: URLs', () => {
      const result = validateSingleUrl('file:///etc/passwd');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('File URLs are not allowed');
    });

    it('should reject URLs with invalid protocols', () => {
      const result = validateSingleUrl('ftp://example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Only HTTP and HTTPS URLs are allowed');
    });

    it('should reject invalid URL format', () => {
      const result = validateSingleUrl('not a url at all');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid URL format');
    });

    it('should handle URLs with paths and query strings', () => {
      const result = validateSingleUrl('https://example.com/path?query=value');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('https://example.com/path?query=value');
    });

    it('should handle URLs with fragments', () => {
      const result = validateSingleUrl('https://example.com#section');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('https://example.com/#section');
    });

    it('should handle URLs with ports', () => {
      const result = validateSingleUrl('https://example.com:8080');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('https://example.com:8080/');
    });

    it('should preserve original URL in result', () => {
      const original = 'example.com/test';
      const result = validateSingleUrl(original);
      expect(result.original).toBe(original);
    });
  });

  describe('validateUrls', () => {
    it('should validate multiple URLs', () => {
      const input = `
        https://example.com
        https://github.com
        https://google.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(3);
      expect(result.invalidUrls).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should filter out empty lines', () => {
      const input = `
        https://example.com

        https://github.com


        https://google.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(3);
    });

    it('should trim whitespace', () => {
      const input = `
          https://example.com
        https://github.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(2);
    });

    it('should identify invalid URLs', () => {
      const input = `
        https://example.com
        javascript:alert(1)
        https://github.com
        not a url
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(2);
      expect(result.invalidUrls).toHaveLength(2);
    });

    it('should detect duplicate URLs', () => {
      const input = `
        https://example.com
        https://github.com
        https://example.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(2);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0]).toBe('https://example.com/');
    });

    it('should detect duplicates after normalization', () => {
      const input = `
        example.com
        https://example.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(1);
      expect(result.duplicates).toHaveLength(1);
    });

    it('should handle mixed valid, invalid, and duplicate URLs', () => {
      const input = `
        https://example.com
        javascript:alert(1)
        https://github.com
        https://example.com
        file:///test
        https://google.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(3);
      expect(result.invalidUrls).toHaveLength(2);
      expect(result.duplicates).toHaveLength(1);
    });

    it('should handle empty input', () => {
      const result = validateUrls('');
      expect(result.validUrls).toHaveLength(0);
      expect(result.invalidUrls).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should handle only whitespace input', () => {
      const result = validateUrls('   \n\n   \n  ');
      expect(result.validUrls).toHaveLength(0);
      expect(result.invalidUrls).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should normalize URLs without protocol', () => {
      const input = `
        example.com
        github.com
      `;

      const result = validateUrls(input);
      expect(result.validUrls).toHaveLength(2);
      expect(result.validUrls[0]).toBe('https://example.com/');
      expect(result.validUrls[1]).toBe('https://github.com/');
    });
  });

  describe('createBulkImportJob', () => {
    it('should create job and bookmarks with fetching status', async () => {
      const urls = [
        'https://example.com/',
        'https://github.com/',
        'https://google.com/',
      ];

      const jobId = await createBulkImportJob(urls);

      const job = await db.jobs.get(jobId);
      expect(job).toBeDefined();
      expect(job?.type).toBe(JobType.BULK_URL_IMPORT);
      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.metadata.totalUrls).toBe(3);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(3);
      expect(bookmarks.every(b => b.status === 'fetching')).toBe(true);
      expect(bookmarks.every(b => b.html === '')).toBe(true);
    });

    it('should handle single URL', async () => {
      const urls = ['https://example.com/'];
      const jobId = await createBulkImportJob(urls);

      const job = await db.jobs.get(jobId);
      expect(job?.metadata.totalUrls).toBe(1);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].url).toBe('https://example.com/');
      expect(bookmarks[0].status).toBe('fetching');
    });

    it('should handle many URLs', async () => {
      const urls = Array.from({ length: 50 }, (_, i) => `https://example${i}.com/`);
      const jobId = await createBulkImportJob(urls);

      const job = await db.jobs.get(jobId);
      expect(job?.metadata.totalUrls).toBe(50);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(50);
    });

    it('should create bookmarks with unique IDs', async () => {
      const urls = ['https://example.com/', 'https://github.com/'];
      await createBulkImportJob(urls);

      const bookmarks = await db.bookmarks.toArray();
      const ids = bookmarks.map(b => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(2);
    });

    it('should return job ID', async () => {
      const urls = ['https://example.com/'];
      const jobId = await createBulkImportJob(urls);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const job = await db.jobs.get(jobId);
      expect(job).toBeDefined();
    });

    it('should reset existing bookmark to fetching status', async () => {
      await db.bookmarks.add({
        id: 'existing-1',
        url: 'https://example.com/',
        title: 'Old Title',
        html: '<html>old content</html>',
        status: 'complete',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await createBulkImportJob(['https://example.com/']);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].id).toBe('existing-1');
      expect(bookmarks[0].status).toBe('fetching');
      expect(bookmarks[0].html).toBe('');
    });

    it('should set bookmark title to URL initially', async () => {
      await createBulkImportJob(['https://example.com/test']);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks[0].title).toBe('https://example.com/test');
    });
  });

  describe('extractTitleFromHtml', () => {
    it('should extract title from HTML', () => {
      const html = '<html><head><title>Test Page</title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('Test Page');
    });

    it('should handle titles with HTML entities', () => {
      const html = '<html><head><title>Test &amp; Page</title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('Test & Page');
    });

    it('should trim whitespace', () => {
      const html = '<html><head><title>  Test Page  </title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('Test Page');
    });

    it('should return empty string if no title', () => {
      const html = '<html><head></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('');
    });

    it('should return empty string for empty title', () => {
      const html = '<html><head><title></title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('');
    });

    it('should handle malformed HTML', () => {
      const html = '<title>Test Page';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('');
    });

    it('should handle case-insensitive title tag', () => {
      const html = '<html><head><TITLE>Test Page</TITLE></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('Test Page');
    });

    it('should extract first title if multiple exist', () => {
      const html = '<html><head><title>First</title><title>Second</title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('First');
    });

    it('should handle titles with special characters', () => {
      const html = '<html><head><title>Test &lt;Page&gt; "Quotes"</title></head><body></body></html>';
      const title = extractTitleFromHtml(html);
      expect(title).toBe('Test <Page> "Quotes"');
    });
  });

  describe('Integration: validateUrls + createBulkImportJob', () => {
    it('should work together for complete workflow', async () => {
      const input = `
        https://example.com
        javascript:alert(1)
        https://github.com
        https://example.com
        https://google.com
      `;

      const validation = validateUrls(input);
      expect(validation.validUrls).toHaveLength(3);
      expect(validation.invalidUrls).toHaveLength(1);
      expect(validation.duplicates).toHaveLength(1);

      const jobId = await createBulkImportJob(validation.validUrls);
      const job = await db.jobs.get(jobId);
      expect(job?.metadata.totalUrls).toBe(3);

      const bookmarks = await db.bookmarks.toArray();
      expect(bookmarks).toHaveLength(3);
      expect(bookmarks.every(b => b.status === 'fetching')).toBe(true);
    });
  });
});
