function waitForSettle(settleTimeMs = 2000, maxWaitMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;

    const done = (): void => {
      clearTimeout(timeout);
      clearTimeout(maxTimeout);
      observer.disconnect();
      resolve();
    };

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(done, settleTimeMs);
    });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- body can be null during early load
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    timeout = setTimeout(done, settleTimeMs);
    const maxTimeout = setTimeout(done, maxWaitMs);
  });
}

async function extractHtml(settleTimeMs = 2000): Promise<string> {
  await waitForSettle(settleTimeMs);
  return document.documentElement.outerHTML;
}

(window as { extractHtml?: typeof extractHtml }).extractHtml = extractHtml;
