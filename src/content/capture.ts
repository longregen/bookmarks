import { sendMessage, type CapturePageResponse, type GetPageHtmlResponse } from '../lib/messages';

async function capturePage(): Promise<boolean> {
  const url = location.href;
  const title = document.title;
  const html = document.documentElement.outerHTML;

  try {
    const response = await sendMessage({
      type: 'bookmark:save_from_page',
      data: { url, title, html }
    });

    if (!response.success) {
      console.error('Failed to save bookmark');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error saving bookmark:', error);
    return false;
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'user_request:capture_current_tab') {
    capturePage().then(
      (success) => sendResponse({ success } satisfies CapturePageResponse),
      () => sendResponse({ success: false } satisfies CapturePageResponse)
    );
    return true;
  } else if (message.type === 'query:current_page_dom') {
    const response: GetPageHtmlResponse = {
      success: true,
      html: document.documentElement.outerHTML
    };
    sendResponse(response);
  }
});
