import '../shared/app.css';
import { db } from '../db/schema';
import { getElement } from '../ui/dom';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';

const viewLoading = getElement('viewLoading');
const viewError = getElement('viewError');
const viewContent = getElement('viewContent');
const viewTitle = getElement('viewTitle');
const viewUrl = getElement('viewUrl');
const backLink = getElement<HTMLAnchorElement>('backLink');
const summarySection = getElement('summarySection');
const summaryContent = getElement('summaryContent');
const screenshotFrame = getElement<HTMLIFrameElement>('screenshotFrame');

const urlParams = new URLSearchParams(window.location.search);
const bookmarkId = urlParams.get('id');

function showError(message: string): void {
  viewLoading.classList.add('hidden');
  viewError.textContent = message;
  viewError.classList.remove('hidden');
}

async function loadView(): Promise<void> {
  if (bookmarkId === null || bookmarkId === '') {
    showError('No bookmark ID provided.');
    return;
  }

  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) {
    showError('Bookmark not found.');
    return;
  }

  viewTitle.textContent = bookmark.title;

  const urlLink = document.createElement('a');
  urlLink.href = bookmark.url;
  urlLink.target = '_blank';
  urlLink.textContent = bookmark.url;
  urlLink.className = 'view-url-link';
  viewUrl.appendChild(urlLink);

  backLink.href = `../library/library.html?bookmarkId=${encodeURIComponent(bookmarkId)}`;

  const summary = await db.summaries.where('bookmarkId').equals(bookmarkId).first();
  if (summary) {
    summaryContent.textContent = summary.content;
    summarySection.classList.remove('hidden');
  }

  if (bookmark.html) {
    const blob = new Blob([bookmark.html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    screenshotFrame.src = blobUrl;
    screenshotFrame.addEventListener('load', () => {
      URL.revokeObjectURL(blobUrl);
    }, { once: true });
  }

  viewLoading.classList.add('hidden');
  viewContent.classList.remove('hidden');
}

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

void loadView();
