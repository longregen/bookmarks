import { db, JobType, JobStatus } from '../db/schema';
import { createJob } from './jobs';
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

  // Create bookmarks with status='fetching' for each URL
  for (const url of urls) {
    const existing = await db.bookmarks.where('url').equals(url).first();
    if (!existing) {
      await db.bookmarks.add({
        id: crypto.randomUUID(),
        url,
        title: url,
        html: '',
        status: 'fetching',
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Reset existing bookmark to be re-fetched
      await db.bookmarks.update(existing.id, {
        status: 'fetching',
        html: '',
        errorMessage: undefined,
        updatedAt: now,
      });
    }
  }

  // Create job as completed log entry
  const job = await createJob({
    type: JobType.BULK_URL_IMPORT,
    status: JobStatus.COMPLETED,
    metadata: {
      totalUrls: urls.length,
    },
  });

  return job.id;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

export function extractTitleFromHtml(html: string): string {
  const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
  if (titleMatch?.[1] !== undefined) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}
