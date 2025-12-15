import { db, JobType, JobStatus } from '../db/schema';
import { createJob, updateJob, completeJob } from './jobs';

/**
 * Validation result for a single URL
 */
export interface UrlValidation {
  original: string;
  normalized: string;
  isValid: boolean;
  error?: string;
}

/**
 * Result of URL validation
 */
export interface ValidationResult {
  validUrls: string[];
  invalidUrls: UrlValidation[];
  duplicates: string[];
}

/**
 * Validate and normalize a list of URLs
 * @param urlsText Raw text containing URLs (one per line)
 * @returns Validation result with valid, invalid, and duplicate URLs
 */
export function validateUrls(urlsText: string): ValidationResult {
  const lines = urlsText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const validUrls: string[] = [];
  const invalidUrls: UrlValidation[] = [];
  const seenUrls = new Set<string>();
  const duplicates: string[] = [];

  for (const line of lines) {
    const validation = validateSingleUrl(line);

    if (!validation.isValid) {
      invalidUrls.push(validation);
      continue;
    }

    // Check for duplicates
    if (seenUrls.has(validation.normalized)) {
      duplicates.push(validation.normalized);
      continue;
    }

    validUrls.push(validation.normalized);
    seenUrls.add(validation.normalized);
  }

  return {
    validUrls,
    invalidUrls,
    duplicates,
  };
}

/**
 * Validate and normalize a single URL
 * @param url URL to validate
 * @returns Validation result
 */
export function validateSingleUrl(url: string): UrlValidation {
  const original = url;

  // Normalize for scheme checks
  const trimmedLower = url.trim().toLowerCase();

  // Reject dangerous URL schemes
  if (trimmedLower.startsWith('javascript:')) {
    return {
      original,
      normalized: '',
      isValid: false,
      error: 'JavaScript URLs are not allowed',
    };
  }

  if (trimmedLower.startsWith('data:')) {
    return {
      original,
      normalized: '',
      isValid: false,
      error: 'Data URLs are not allowed',
    };
  }

  if (trimmedLower.startsWith('vbscript:')) {
    return {
      original,
      normalized: '',
      isValid: false,
      error: 'VBScript URLs are not allowed',
    };
  }

  if (trimmedLower.startsWith('file:')) {
    return {
      original,
      normalized: '',
      isValid: false,
      error: 'File URLs are not allowed',
    };
  }

  // Add https:// if no protocol specified
  let normalized = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalized = 'https://' + url;
  }

  // Try to parse as URL
  try {
    const urlObj = new URL(normalized);

    // Only allow http and https
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return {
        original,
        normalized: '',
        isValid: false,
        error: 'Only HTTP and HTTPS URLs are allowed',
      };
    }

    // Ensure there's a host
    if (!urlObj.host) {
      return {
        original,
        normalized: '',
        isValid: false,
        error: 'Invalid URL: missing host',
      };
    }

    return {
      original,
      normalized: urlObj.href,
      isValid: true,
    };
  } catch (error) {
    return {
      original,
      normalized: '',
      isValid: false,
      error: 'Invalid URL format',
    };
  }
}

/**
 * Create bulk import job and child jobs for each URL
 * @param urls List of validated URLs to import
 * @returns Parent job ID
 */
export async function createBulkImportJob(urls: string[]): Promise<string> {
  // Create parent job
  const parentJob = await createJob({
    type: JobType.BULK_URL_IMPORT,
    status: JobStatus.IN_PROGRESS,
    progress: 0,
    metadata: {
      totalUrls: urls.length,
      successCount: 0,
      failureCount: 0,
    },
  });

  // Create child job for each URL
  const childJobs = await Promise.all(
    urls.map(url =>
      createJob({
        type: JobType.URL_FETCH,
        status: JobStatus.PENDING,
        parentJobId: parentJob.id,
        metadata: { url },
      })
    )
  );

  return parentJob.id;
}

/**
 * Decode common HTML entities to their text representation
 * @param text Text with HTML entities
 * @returns Decoded text
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Extract title from HTML string
 * @param html HTML content
 * @returns Extracted title or empty string
 */
export function extractTitleFromHtml(html: string): string {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    // Decode HTML entities using regex-based approach (CSP-safe)
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}

/**
 * Check if a URL already exists in the bookmarks
 * @param url URL to check
 * @returns True if bookmark exists
 */
export async function bookmarkExists(url: string): Promise<boolean> {
  const existing = await db.bookmarks.where('url').equals(url).first();
  return !!existing;
}

/**
 * Get existing bookmark URLs to check for duplicates
 * @param urls URLs to check
 * @returns Set of URLs that already exist
 */
export async function getExistingUrls(urls: string[]): Promise<Set<string>> {
  const existing = new Set<string>();

  for (const url of urls) {
    if (await bookmarkExists(url)) {
      existing.add(url);
    }
  }

  return existing;
}
