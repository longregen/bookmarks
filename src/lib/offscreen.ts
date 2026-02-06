import { getErrorMessage } from './errors';
import type { OffscreenReadyResponse } from './messages';
import { sleep } from './time';

let creatingOffscreen: Promise<void> | null = null;
let offscreenReady = false;

const PING_INITIAL_DELAY_MS = 50;
const PING_MAX_DELAY_MS = 500;
const PING_TIMEOUT_MS = 200;
const MAX_PING_ATTEMPTS = 10;

async function pingOffscreen(timeoutMs: number = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(false);
    }, timeoutMs);

    chrome.runtime.sendMessage(
      { type: 'offscreen:ping' },
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

  console.warn('[Offscreen] Document did not respond to pings, proceeding anyway');
}

async function createOffscreenSafely(offscreenApi: typeof chrome.offscreen): Promise<void> {
  try {
    await offscreenApi.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Parse HTML content for bookmark processing',
    });
    console.log('[Offscreen] Document created');
    await waitForOffscreenReady();
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    if (errorMessage.includes('single offscreen')) {
      await waitForOffscreenReady();
    } else {
      console.error('[Offscreen] Error creating document:', error);
    }
  } finally {
    creatingOffscreen = null;
  }
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (!__IS_CHROME__) {
    return;
  }

  const offscreenApi = chrome.offscreen;
  if (typeof offscreenApi.createDocument !== 'function') {
    return;
  }

  if (creatingOffscreen !== null) {
    await creatingOffscreen;
    return;
  }

  const runtimeApi = chrome.runtime;
  if (typeof runtimeApi.getContexts !== 'function') {
    creatingOffscreen = createOffscreenSafely(offscreenApi);
    await creatingOffscreen;
    return;
  }

  try {
    const existingContexts = await runtimeApi.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts.length > 0) {
      await waitForOffscreenReady();
      return;
    }

    creatingOffscreen = createOffscreenSafely(offscreenApi);
    await creatingOffscreen;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (!errorMessage.includes('single offscreen')) {
      console.error('[Offscreen] Error checking contexts:', error);
    }
  }
}

export function resetOffscreenState(): void {
  offscreenReady = false;
}
