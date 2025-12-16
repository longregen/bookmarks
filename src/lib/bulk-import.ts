import { db, JobType, JobStatus } from '../db/schema';
import { createJob, updateJob, completeJob } from './jobs';

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
  const original = url;
  const trimmedLower = url.trim().toLowerCase();

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

  let normalized = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalized = 'https://' + url;
  }

  try {
    const urlObj = new URL(normalized);

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return {
        original,
        normalized: '',
        isValid: false,
        error: 'Only HTTP and HTTPS URLs are allowed',
      };
    }

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

export async function createBulkImportJob(urls: string[]): Promise<string> {
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

  await Promise.all(
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

export function extractTitleFromHtml(html: string): string {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}

export async function bookmarkExists(url: string): Promise<boolean> {
  const existing = await db.bookmarks.where('url').equals(url).first();
  return !!existing;
}
