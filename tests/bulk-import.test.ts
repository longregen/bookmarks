import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, JobType, JobStatus } from '../src/db/schema';
import {
  validateUrls,
  validateSingleUrl,
  createBulkImportJob,
  extractTitleFromHtml,
  bookmarkExists,
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
    it('should create parent job and child jobs', async () => {
      const urls = [
        'https://example.com',
        'https://github.com',
        'https://google.com',
      ];

      const parentJobId = await createBulkImportJob(urls);

      // Verify parent job
      const parentJob = await db.jobs.get(parentJobId);
      expect(parentJob).toBeDefined();
      expect(parentJob?.type).toBe(JobType.BULK_URL_IMPORT);
      expect(parentJob?.status).toBe(JobStatus.IN_PROGRESS);
      expect(parentJob?.progress).toBe(0);
      expect(parentJob?.metadata.totalUrls).toBe(3);
      expect(parentJob?.metadata.successCount).toBe(0);
      expect(parentJob?.metadata.failureCount).toBe(0);

      // Verify child jobs
      const childJobs = await db.jobs.where('parentJobId').equals(parentJobId).toArray();
      expect(childJobs).toHaveLength(3);

      // Sort child jobs by URL to ensure consistent ordering
      childJobs.sort((a, b) => (a.metadata.url || '').localeCompare(b.metadata.url || ''));
      const sortedUrls = [...urls].sort();

      for (let i = 0; i < childJobs.length; i++) {
        const childJob = childJobs[i];
        expect(childJob.type).toBe(JobType.URL_FETCH);
        expect(childJob.status).toBe(JobStatus.PENDING);
        expect(childJob.parentJobId).toBe(parentJobId);
        expect(childJob.metadata.url).toBe(sortedUrls[i]);
      }
    });

    it('should handle single URL', async () => {
      const urls = ['https://example.com'];
      const parentJobId = await createBulkImportJob(urls);

      const parentJob = await db.jobs.get(parentJobId);
      expect(parentJob?.metadata.totalUrls).toBe(1);

      const childJobs = await db.jobs.where('parentJobId').equals(parentJobId).toArray();
      expect(childJobs).toHaveLength(1);
    });

    it('should handle many URLs', async () => {
      const urls = Array.from({ length: 50 }, (_, i) => `https://example${i}.com`);
      const parentJobId = await createBulkImportJob(urls);

      const parentJob = await db.jobs.get(parentJobId);
      expect(parentJob?.metadata.totalUrls).toBe(50);

      const childJobs = await db.jobs.where('parentJobId').equals(parentJobId).toArray();
      expect(childJobs).toHaveLength(50);
    });

    it('should create jobs with unique IDs', async () => {
      const urls = ['https://example.com', 'https://github.com'];
      const parentJobId = await createBulkImportJob(urls);

      const childJobs = await db.jobs.where('parentJobId').equals(parentJobId).toArray();
      const ids = childJobs.map(j => j.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(2);
    });

    it('should return parent job ID', async () => {
      const urls = ['https://example.com'];
      const parentJobId = await createBulkImportJob(urls);

      expect(parentJobId).toBeDefined();
      expect(typeof parentJobId).toBe('string');

      const parentJob = await db.jobs.get(parentJobId);
      expect(parentJob).toBeDefined();
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
      // Malformed HTML without closing tag won't match the regex
      const html = '<title>Test Page';
      const title = extractTitleFromHtml(html);
      expect(title).toBe(''); // Returns empty string for malformed HTML
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

  describe('bookmarkExists', () => {
    it('should return true if bookmark exists', async () => {
      await db.bookmarks.add({
        id: 'test-id',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const exists = await bookmarkExists('https://example.com');
      expect(exists).toBe(true);
    });

    it('should return false if bookmark does not exist', async () => {
      const exists = await bookmarkExists('https://nonexistent.com');
      expect(exists).toBe(false);
    });

    it('should be case-sensitive', async () => {
      await db.bookmarks.add({
        id: 'test-id',
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const exists = await bookmarkExists('https://EXAMPLE.COM');
      expect(exists).toBe(false);
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

      const parentJobId = await createBulkImportJob(validation.validUrls);
      const parentJob = await db.jobs.get(parentJobId);
      expect(parentJob?.metadata.totalUrls).toBe(3);

      const childJobs = await db.jobs.where('parentJobId').equals(parentJobId).toArray();
      expect(childJobs).toHaveLength(3);
    });
  });
});
