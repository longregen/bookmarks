export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

const API_CONFIG_ERROR_PATTERNS = [
  'api key',
  'not configured',
  '401',
  'unauthorized',
] as const;

export function isApiConfigError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return API_CONFIG_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}
