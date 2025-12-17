/**
 * Shared URL validation utilities
 * Consolidates URL validation logic used across WebDAV sync, bulk import, and options UI
 */

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  normalizedUrl?: string;
}

export interface UrlValidationOptions {
  requireHttps?: boolean;
  allowedProtocols?: string[];
  requireTrailingSlash?: boolean;
  trimWhitespace?: boolean;
  autoAddProtocol?: boolean;
  allowedSchemes?: string[];
  blockedSchemes?: Record<string, string>;
}

const DEFAULT_BLOCKED_SCHEMES: Record<string, string> = {
  'javascript:': 'JavaScript URLs are not allowed',
  'data:': 'Data URLs are not allowed',
  'vbscript:': 'VBScript URLs are not allowed',
  'file:': 'File URLs are not allowed',
};

/**
 * Validate a URL with configurable options
 */
// eslint-disable-next-line complexity
export function validateUrl(url: string, options: UrlValidationOptions = {}): UrlValidationResult {
  const {
    requireHttps = false,
    allowedProtocols = ['http:', 'https:'],
    requireTrailingSlash = false,
    trimWhitespace = true,
    autoAddProtocol = false,
    blockedSchemes,
  } = options;

  let processedUrl = trimWhitespace ? url.trim() : url;

  if (!processedUrl) {
    return { valid: false, error: 'URL is required' };
  }

  const trimmedLower = processedUrl.toLowerCase();
  const schemesToBlock = blockedSchemes ?? DEFAULT_BLOCKED_SCHEMES;

  for (const [scheme, error] of Object.entries(schemesToBlock)) {
    if (trimmedLower.startsWith(scheme)) {
      return { valid: false, error };
    }
  }

  if (autoAddProtocol && !processedUrl.includes('://')) {
    processedUrl = `https://${processedUrl}`;
  }

  let urlObj: URL;
  try {
    urlObj = new URL(processedUrl);
  } catch (_error) {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!allowedProtocols.includes(urlObj.protocol)) {
    return {
      valid: false,
      error: `Only ${allowedProtocols.map(p => p.replace(':', '').toUpperCase()).join(' and ')} URLs are allowed`,
    };
  }

  if (!urlObj.host) {
    return { valid: false, error: 'Invalid URL: missing host' };
  }

  let warning: string | undefined;
  if (urlObj.protocol === 'http:') {
    if (requireHttps) {
      return {
        valid: false,
        error: 'HTTP connections are not allowed for security reasons. Please use HTTPS or enable "Allow insecure connections" in settings.',
      };
    } else {
      warning = 'Using HTTP (insecure connection)';
    }
  }

  let normalizedUrl = urlObj.href;
  if (requireTrailingSlash && !normalizedUrl.endsWith('/')) {
    normalizedUrl += '/';
  }

  return {
    valid: true,
    normalizedUrl,
    warning,
  };
}

/**
 * Validate a WebDAV URL specifically
 * Used for WebDAV sync configuration
 */
export function validateWebDAVUrl(url: string, allowInsecure = false): UrlValidationResult {
  if (!url) {
    return { valid: false, error: 'WebDAV URL is not configured' };
  }

  return validateUrl(url, {
    requireHttps: !allowInsecure,
    allowedProtocols: ['http:', 'https:'],
    trimWhitespace: true,
    autoAddProtocol: false,
  });
}

/**
 * Validate a general web URL (for bulk import)
 * Allows auto-adding https:// protocol and blocks dangerous schemes
 */
export function validateWebUrl(url: string): UrlValidationResult {
  return validateUrl(url, {
    requireHttps: false,
    allowedProtocols: ['http:', 'https:'],
    trimWhitespace: true,
    autoAddProtocol: true,
    blockedSchemes: DEFAULT_BLOCKED_SCHEMES,
  });
}
