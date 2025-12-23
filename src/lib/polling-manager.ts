export interface Poller {
  start(): void;
  stop(): void;
}

export interface PollerOptions {
  immediate?: boolean;
}

export function createPoller(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options?: PollerOptions
): Poller {
  let intervalId: number | null = null;

  const start = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    if (options?.immediate === true) {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('Error in poller callback:', error);
        });
      }
    }

    intervalId = window.setInterval(() => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('Error in poller callback:', error);
        });
      }
    }, intervalMs);
  };

  const stop = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  return {
    start,
    stop,
  };
}
