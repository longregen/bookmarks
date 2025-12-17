import type { SaveBookmarkResponse, CapturePageResponse, GetPageHtmlResponse } from '../lib/messages';

async function capturePage(): Promise<void> {
  const url = location.href;
  const title = document.title;
  const html = document.documentElement.outerHTML;

  try {
    const response: SaveBookmarkResponse | undefined = await chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK',
      data: { url, title, html }
    });

    if (response?.success !== true) {
      console.error('Failed to save bookmark');
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE') {
    void capturePage();
    const response: CapturePageResponse = { success: true };
    sendResponse(response);
  } else if (message.type === 'GET_PAGE_HTML') {
    const response: GetPageHtmlResponse = {
      success: true,
      html: document.documentElement.outerHTML
    };
    sendResponse(response);
  }
  return true;
});
