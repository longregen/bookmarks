import { db } from '../db/schema';
import { showStatusMessage } from '../lib/dom';

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const exploreBtn = document.getElementById('exploreBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const totalCount = document.getElementById('totalCount') as HTMLSpanElement;
const pendingCount = document.getElementById('pendingCount') as HTMLSpanElement;
const completeCount = document.getElementById('completeCount') as HTMLSpanElement;

async function updateStats() {
  try {
    const all = await db.bookmarks.toArray();
    const pending = all.filter(b => b.status === 'pending' || b.status === 'processing');
    const complete = all.filter(b => b.status === 'complete');

    totalCount.textContent = all.length.toString();
    pendingCount.textContent = pending.length.toString();
    completeCount.textContent = complete.length.toString();
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}


saveBtn.addEventListener('click', async () => {
  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      showStatusMessage(statusDiv, 'No active tab found', 'error');
      return;
    }

    // Inject content script to capture the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const url = location.href;
        const title = document.title;
        const html = document.documentElement.outerHTML;

        return await chrome.runtime.sendMessage({
          type: 'SAVE_BOOKMARK',
          data: { url, title, html }
        });
      }
    });

    showStatusMessage(statusDiv, 'Bookmark saved!', 'success');
    await updateStats();
  } catch (error) {
    console.error('Error saving bookmark:', error);
    showStatusMessage(statusDiv, 'Failed to save bookmark', 'error');
  } finally {
    saveBtn.disabled = false;
    // Use DOM APIs instead of innerHTML (CSP-safe)
    saveBtn.textContent = '';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.textContent = '📌';
    saveBtn.appendChild(iconSpan);
    saveBtn.appendChild(document.createTextNode(' Save This Page'));
  }
});

exploreBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/explore/explore.html') });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Initial stats update
updateStats();

// Update stats every 2 seconds
setInterval(updateStats, 2000);
