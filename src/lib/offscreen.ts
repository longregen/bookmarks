import { getErrorMessage } from './errors';
import type { OffscreenReadyResponse } from './messages';

// Mutex to prevent concurrent offscreen document creation attempts
let creatingOffscreen: Promise<void> | null = null;

// Track if the offscreen document is confirmed ready
let offscreenReady = false;

// Configuration for retry with exponential backoff
const PING_INITIAL_DELAY_MS = 50;
const PING_MAX_DELAY_MS = 500;
const PING_TIMEOUT_MS = 200;
const MAX_PING_ATTEMPTS = 10;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

async function pingOffscreen(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(false);
    }, timeoutMs);

    chrome.runtime.sendMessage(
      { type: 'OFFSCREEN_PING' },
      (response: OffscreenReadyResponse | undefined) => {
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(response?.ready === true);
      }
    );
  });
}

async function waitForOffscreenReady(): Promise<void> {
  if (offscreenReady) {
    return;
  }

  let delay = PING_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_PING_ATTEMPTS; attempt++) {
    const ready = await pingOffscreen();
    if (ready) {
      offscreenReady = true;
      console.log(`[Offscreen] Ready after ${attempt} ping attempt(s)`);
      return;
    }

    if (attempt < MAX_PING_ATTEMPTS) {
      await sleep(delay);
      delay = Math.min(delay * 2, PING_MAX_DELAY_MS);
    }
  }

  // If we get here, the offscreen document didn't respond to pings
  // This shouldn't happen normally, but we'll proceed anyway and let
  // the actual message timeout handle failures
  console.warn('[Offscreen] Document did not respond to pings, proceeding anyway');
}

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
        // Wait for the document to be ready
        await waitForOffscreenReady();
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        if (!errorMessage.includes('single offscreen')) {
          console.error('[Offscreen] Error creating document:', error);
        } else {
          // Document already exists, wait for it to be ready
          await waitForOffscreenReady();
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
      // Document exists, ensure it's ready
      await waitForOffscreenReady();
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
        // Wait for the document to be ready
        await waitForOffscreenReady();
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        // "single offscreen" error just means it already exists - that's fine
        if (!errorMessage.includes('single offscreen')) {
          console.error('[Offscreen] Error creating document:', error);
        } else {
          // Document already exists, wait for it to be ready
          await waitForOffscreenReady();
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

// Reset the ready state (useful if the offscreen document is closed)
export function resetOffscreenState(): void {
  offscreenReady = false;
}
