import { getErrorMessage } from './errors';

export function isFirefox(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined') {
    return;
  }

  const offscreenApi = chrome.offscreen;
  if (typeof offscreenApi.createDocument !== 'function') {
    return;
  }

  const runtimeApi = chrome.runtime;
  if (typeof runtimeApi.getContexts !== 'function') {
    try {
      await offscreenApi.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Parse HTML content for bookmark processing',
      });
      console.log('[Offscreen] Document created (without context check)');
    } catch (error: unknown) {
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
