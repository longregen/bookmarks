import { getErrorMessage } from './errors';

export function isFirefox(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
}

/**
 * Ensure offscreen document exists (Chrome only)
 * Uses feature detection to avoid Firefox compatibility issues
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined') {
    return;
  }

  const offscreenApi = chrome.offscreen;
  if (!offscreenApi || typeof offscreenApi.createDocument !== 'function') {
    return;
  }

  // Check for runtime.getContexts API (Chrome 116+)
  const runtimeApi = chrome.runtime;
  if (!runtimeApi.getContexts || typeof runtimeApi.getContexts !== 'function') {
    // Fallback: try to create document without checking existing contexts
    // This may fail if document already exists, but that's acceptable
    try {
      await offscreenApi.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Parse HTML content for bookmark processing',
      });
      console.log('[Offscreen] Document created (without context check)');
    } catch (error: unknown) {
      // Ignore "already exists" errors
      const errorMessage = getErrorMessage(error);
      if (!errorMessage.includes('single offscreen')) {
        console.error('[Offscreen] Error creating document:', error);
      }
    }
    return;
  }

  try {
    const existingContexts = await runtimeApi.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      return;
    }

    await offscreenApi.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Parse HTML content for bookmark processing',
    });

    console.log('[Offscreen] Document created');
  } catch (error) {
    console.error('[Offscreen] Error creating document:', error);
  }
}
