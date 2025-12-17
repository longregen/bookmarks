import { getTheme, getEffectiveTheme } from '../shared/theme';
import type { SaveBookmarkResponse, CapturePageResponse } from '../lib/messages';

const themeCssVariables = {
  light: `
    --toast-success-bg: #d1fae5;
    --toast-success-text: #065f46;
    --toast-success-border: #6ee7b7;
    --toast-error-bg: #fee2e2;
    --toast-error-text: #991b1b;
    --toast-error-border: #fca5a5;
    --toast-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --toast-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  `,
  dark: `
    --toast-success-bg: #065f46;
    --toast-success-text: #d1fae5;
    --toast-success-border: #059669;
    --toast-error-bg: #7f1d1d;
    --toast-error-text: #fecaca;
    --toast-error-border: #dc2626;
    --toast-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --toast-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  `,
  terminal: `
    --toast-success-bg: #001100;
    --toast-success-text: #00ff00;
    --toast-success-border: #00ff00;
    --toast-error-bg: #110000;
    --toast-error-text: #ff3333;
    --toast-error-border: #ff3333;
    --toast-font-family: monospace;
    --toast-shadow: 0 4px 6px rgba(0, 255, 0, 0.1);
  `,
  tufte: `
    --toast-success-bg: #fffff8;
    --toast-success-text: #111111;
    --toast-success-border: #111111;
    --toast-error-bg: #fffff8;
    --toast-error-text: #a00000;
    --toast-error-border: #a00000;
    --toast-font-family: et-book, Palatino, 'Palatino Linotype', 'Palatino LT STD', Georgia, serif;
    --toast-shadow: none;
  `
};

async function capturePage(): Promise<void> {
  const url = location.href;
  const title = document.title;
  const html = document.documentElement.outerHTML;

  try {
    const response: SaveBookmarkResponse | undefined = await chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK',
      data: { url, title, html }
    });

    if (response?.success === true) {
      void showNotification('Bookmark saved!', 'success');
    } else {
      void showNotification('Failed to save bookmark', 'error');
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);
    void showNotification('Error saving bookmark', 'error');
  }
}

function injectThemeVariables(effectiveTheme: 'light' | 'dark' | 'terminal' | 'tufte'): void {
  const styleId = 'bookmark-rag-toast-theme';
  let styleEl = document.getElementById(styleId);

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `:root { ${themeCssVariables[effectiveTheme]} }`;
}

async function showNotification(message: string, type: 'success' | 'error'): Promise<void> {
  const theme = await getTheme();
  const effectiveTheme = getEffectiveTheme(theme);
  injectThemeVariables(effectiveTheme);

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    background: var(--toast-${type}-bg);
    color: var(--toast-${type}-text);
    border: 1px solid var(--toast-${type}-border);
    border-radius: 8px;
    font-family: var(--toast-font-family);
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--toast-shadow);
    z-index: 999999;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE') {
    void capturePage();
    const response: CapturePageResponse = { success: true };
    sendResponse(response);
  }
  return true;
});
