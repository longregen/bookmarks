function waitForSettle(settleTimeMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, settleTimeMs);
    });

    observer.observe(document.body as Node | null ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    timeout = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, settleTimeMs);
  });
}

async function extractHtml(settleTimeMs = 2000): Promise<string> {
  await waitForSettle(settleTimeMs);
  return document.documentElement.outerHTML;
}

(window as { extractHtml?: typeof extractHtml }).extractHtml = extractHtml;
