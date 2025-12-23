import { db, JobType, JobStatus } from '../db/schema';
import { createJob, createJobItems } from './jobs';
import { validateWebUrl } from './url-validator';

export interface UrlValidation {
  original: string;
  normalized: string;
  isValid: boolean;
  error?: string;
}

export interface ValidationResult {
  validUrls: string[];
  invalidUrls: UrlValidation[];
  duplicates: string[];
}

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

export function validateSingleUrl(url: string): UrlValidation {
  const result = validateWebUrl(url);

  return {
    original: url,
    normalized: result.normalizedUrl ?? '',
    isValid: result.valid,
    error: result.error,
  };
}

export async function createBulkImportJob(urls: string[]): Promise<string> {
  const now = new Date();
  const bookmarkIds: string[] = [];

  // Load all existing bookmarks for the given URLs in one query
  const existingBookmarks = await db.bookmarks.where('url').anyOf(urls).toArray();
  const existingByUrl = new Map(existingBookmarks.map(b => [b.url, b]));

  // Separate new URLs from existing ones
  const newBookmarks = [];
  const updatedBookmarks = [];

  for (const url of urls) {
    const existing = existingByUrl.get(url);
    if (!existing) {
      const id = crypto.randomUUID();
      newBookmarks.push({
        id,
        url,
        title: url,
        html: '',
        status: 'fetching' as const,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      bookmarkIds.push(id);
    } else {
      // Reset existing bookmark to be re-fetched
      updatedBookmarks.push({
        ...existing,
        status: 'fetching' as const,
        html: '',
        errorMessage: undefined,
        retryCount: 0,
        updatedAt: now,
      });
      bookmarkIds.push(existing.id);
    }
  }

  // Use bulk operations for better performance
  if (newBookmarks.length > 0) {
    await db.bookmarks.bulkAdd(newBookmarks);
  }
  if (updatedBookmarks.length > 0) {
    await db.bookmarks.bulkPut(updatedBookmarks);
  }

  // Create job with IN_PROGRESS status (will be updated as items complete)
  const job = await createJob({
    type: JobType.BULK_URL_IMPORT,
    status: JobStatus.IN_PROGRESS,
    metadata: {
      totalUrls: urls.length,
    },
  });

  // Create job items for each bookmark
  await createJobItems(job.id, bookmarkIds);

  return job.id;
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&amp;': '&',
  };
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-z]+));/gi, (match, dec?: string, hex?: string, named?: string) => {
    if (dec !== undefined) return String.fromCharCode(parseInt(dec, 10));
    if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
    if (named !== undefined) return entities[`&${named};`] ?? match;
    return match;
  });
}

export function extractTitleFromHtml(html: string): string {
  const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
  if (titleMatch?.[1] !== undefined) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}
