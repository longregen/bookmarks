// Content script for capturing the current page as a bookmark
// This script is injected when the user triggers the bookmark action

import { getTheme, getEffectiveTheme } from '../shared/theme';

// Theme-aware toast colors
const toastColors = {
  light: {
    success: { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
    error: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' }
  },
  dark: {
    success: { bg: '#065f46', text: '#d1fae5', border: '#059669' },
    error: { bg: '#7f1d1d', text: '#fecaca', border: '#dc2626' }
  },
  terminal: {
    success: { bg: '#001100', text: '#00ff00', border: '#00ff00' },
    error: { bg: '#110000', text: '#ff3333', border: '#ff3333' }
  }
};

async function capturePage() {
  const url = location.href;
  const title = document.title;
  const html = document.documentElement.outerHTML;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_BOOKMARK',
      data: { url, title, html }
    });

    if (response?.success) {
      showNotification('Bookmark saved!', 'success');
    } else {
      showNotification('Failed to save bookmark', 'error');
    }
  } catch (error) {
    console.error('Error saving bookmark:', error);
    showNotification('Error saving bookmark', 'error');
  }
}

async function showNotification(message: string, type: 'success' | 'error') {
  // Get the user's theme preference
  const theme = await getTheme();
  const effectiveTheme = getEffectiveTheme(theme);
  const colors = toastColors[effectiveTheme][type];

  // Create a simple toast notification
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    background: ${colors.bg};
    color: ${colors.text};
    border: 1px solid ${colors.border};
    border-radius: 8px;
    font-family: ${effectiveTheme === 'terminal' ? 'monospace' : "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"};
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    z-index: 999999;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

// Add CSS animations
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

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE') {
    capturePage();
    sendResponse({ success: true });
  }
  return true;
});
