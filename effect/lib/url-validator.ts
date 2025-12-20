import * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';

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

export class UrlValidator extends Context.Tag('UrlValidator')<
  UrlValidator,
  {
    validateUrl(
      url: string,
      options?: UrlValidationOptions
    ): Effect.Effect<UrlValidationResult, never>;
    validateWebDAVUrl(
      url: string,
      allowInsecure?: boolean
    ): Effect.Effect<UrlValidationResult, never>;
    validateWebUrl(url: string): Effect.Effect<UrlValidationResult, never>;
  }
>() {}

function validateUrlImpl(
  url: string,
  options: UrlValidationOptions = {}
): UrlValidationResult {
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

function validateWebDAVUrlImpl(url: string, allowInsecure = false): UrlValidationResult {
  if (!url) {
    return { valid: false, error: 'WebDAV URL is not configured' };
  }

  return validateUrlImpl(url, {
    requireHttps: !allowInsecure,
    allowedProtocols: ['http:', 'https:'],
    trimWhitespace: true,
    autoAddProtocol: false,
  });
}

function validateWebUrlImpl(url: string): UrlValidationResult {
  return validateUrlImpl(url, {
    requireHttps: false,
    allowedProtocols: ['http:', 'https:'],
    trimWhitespace: true,
    autoAddProtocol: true,
    blockedSchemes: DEFAULT_BLOCKED_SCHEMES,
  });
}

export const UrlValidatorLive: Layer.Layer<UrlValidator, never> = Layer.succeed(
  UrlValidator,
  {
    validateUrl: (url: string, options?: UrlValidationOptions) =>
      Effect.sync(() => validateUrlImpl(url, options)),

    validateWebDAVUrl: (url: string, allowInsecure = false) =>
      Effect.sync(() => validateWebDAVUrlImpl(url, allowInsecure)),

    validateWebUrl: (url: string) =>
      Effect.sync(() => validateWebUrlImpl(url)),
  }
);

// Convenience functions that run effects with default runtime
export const validateUrl = (
  url: string,
  options?: UrlValidationOptions
): Effect.Effect<UrlValidationResult, never> =>
  Effect.gen(function* () {
    const validator = yield* UrlValidator;
    return yield* validator.validateUrl(url, options);
  });

export const validateWebDAVUrl = (
  url: string,
  allowInsecure = false
): Effect.Effect<UrlValidationResult, never> =>
  Effect.gen(function* () {
    const validator = yield* UrlValidator;
    return yield* validator.validateWebDAVUrl(url, allowInsecure);
  });

export const validateWebUrl = (url: string): Effect.Effect<UrlValidationResult, never> =>
  Effect.gen(function* () {
    const validator = yield* UrlValidator;
    return yield* validator.validateWebUrl(url);
  });
