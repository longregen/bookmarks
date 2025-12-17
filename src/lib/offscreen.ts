import { getErrorMessage } from './errors';

// Mutex to prevent concurrent offscreen document creation attempts
let creatingOffscreen: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  // This function is only needed for Chrome - dead code eliminated in Firefox/Web builds
  if (!__IS_CHROME__) {
    return;
  }

  const offscreenApi = chrome.offscreen;
  if (typeof offscreenApi.createDocument !== 'function') {
    return;
  }

  // If creation is already in progress, wait for it
  if (creatingOffscreen !== null) {
    await creatingOffscreen;
    return;
  }

  const runtimeApi = chrome.runtime;
  if (typeof runtimeApi.getContexts !== 'function') {
    creatingOffscreen = (async () => {
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
      } finally {
        creatingOffscreen = null;
      }
    })();
    await creatingOffscreen;
    return;
  }

  try {
    const existingContexts = await runtimeApi.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      return;
    }

    creatingOffscreen = (async () => {
      try {
        await offscreenApi.createDocument({
          url: 'src/offscreen/offscreen.html',
          reasons: ['DOM_SCRAPING'],
          justification: 'Parse HTML content for bookmark processing',
        });
        console.log('[Offscreen] Document created');
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        // "single offscreen" error just means it already exists - that's fine
        if (!errorMessage.includes('single offscreen')) {
          console.error('[Offscreen] Error creating document:', error);
        }
      } finally {
        creatingOffscreen = null;
      }
    })();
    await creatingOffscreen;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (!errorMessage.includes('single offscreen')) {
      console.error('[Offscreen] Error checking contexts:', error);
    }
  }
}
