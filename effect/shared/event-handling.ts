import { addEventListener as addBookmarkEventListener } from '../lib/events';

export interface EventHandlerConfig {
  onBookmarkChange?: () => void;
  onTagChange?: () => void;
}

export interface EventHandlerCleanup {
  removeListener: () => void;
  cleanup: () => void;
}

export function setupBookmarkEventHandlers(
  config: EventHandlerConfig
): EventHandlerCleanup {
  const removeListener = addBookmarkEventListener((event) => {
    if (event.type.startsWith('bookmark:') && config.onBookmarkChange) {
      config.onBookmarkChange();
    }
    if (event.type.startsWith('tag:') && config.onTagChange) {
      config.onTagChange();
    }
  });

  const cleanup = () => {
    removeListener();
  };

  window.addEventListener('beforeunload', cleanup);

  return {
    removeListener,
    cleanup,
  };
}

export function setupBeforeUnloadCleanup(cleanupFn: () => void): void {
  window.addEventListener('beforeunload', cleanupFn);
}
