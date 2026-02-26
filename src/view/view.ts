import '../shared/app.css';
import { db, getBookmarkContent } from '../db/schema';
import { createElement, getElement, setSanitizedHTML } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { parseMarkdown } from '../lib/markdown';
import { createTagEditor } from '../ui/tag-editor';
import { exportSingleBookmark } from '../lib/export';
import { downloadExport, downloadMarkdown, downloadHtml, copyMarkdown, type ExportFormat } from '../ui/export-download';
import { retryBookmark, deleteBookmarkWithData } from '../lib/jobs';
import { ServerApiClient } from '../lib/server-api';
import { serverSync } from '../lib/server-sync';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';

const viewError = getElement('viewError');
const viewContent = getElement('viewContent');
const viewTitle = getElement('viewTitle');
const viewMeta = getElement('viewMeta');
const tagEditorContainer = getElement('tagEditorContainer');
const summarySection = getElement('summarySection');
const summaryContent = getElement('summaryContent');
const markdownSection = getElement('markdownSection');
const qaSection = getElement('qaSection');
const backBtn = getElement<HTMLButtonElement>('backBtn');
const retryBtn = getElement<HTMLButtonElement>('retryBtn');
const debugBtn = getElement<HTMLButtonElement>('debugBtn');
const exportBtn = getElement<HTMLButtonElement>('exportBtn');
const deleteBtn = getElement<HTMLButtonElement>('deleteBtn');

const urlParams = new URLSearchParams(window.location.search);
const bookmarkId = urlParams.get('id');
const fromPage = urlParams.get('from') ?? 'library';

const backUrls: Record<string, string> = {
  library: '../library/library.html',
  search: '../search/search.html',
  stumble: '../stumble/stumble.html',
};

function showError(message: string): void {
  viewError.textContent = message;
  viewError.classList.remove('hidden');
}

backBtn.addEventListener('click', () => {
  window.location.href = backUrls[fromPage] || backUrls.library;
});

function showExportMenu(): void {
  if (bookmarkId === null) return;

  const existingMenu = document.querySelector('.export-format-menu');
  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  const menu = createElement('div', { className: 'export-format-menu' });
  const formats: { format: ExportFormat; label: string }[] = [
    { format: 'json', label: 'JSON (Full backup)' },
    { format: 'markdown', label: 'Markdown' },
    { format: 'copy-markdown', label: 'Copy Markdown' },
    { format: 'html', label: 'Raw HTML' },
  ];

  for (const { format, label } of formats) {
    const item = createElement('button', {
      className: 'export-format-item',
      textContent: label,
    });
    item.addEventListener('click', () => {
      menu.remove();
      void performExport(format);
    });
    menu.appendChild(item);
  }

  const btnRect = exportBtn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${btnRect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - btnRect.right}px`;

  document.body.appendChild(menu);

  const closeHandler = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && e.target !== exportBtn) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

async function performExport(format: ExportFormat): Promise<void> {
  if (bookmarkId === null) return;

  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';
  try {
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) return;

    if (format === 'json') {
      const data = await exportSingleBookmark(bookmarkId);
      downloadExport(data);
    } else if (format === 'markdown' || format === 'copy-markdown') {
      const { markdown } = await getBookmarkContent(bookmarkId);
      const content = markdown?.content ?? '_No content available_';
      const fullContent = `# ${bookmark.title}\n\n**URL:** ${bookmark.url}\n**Saved:** ${bookmark.createdAt.toISOString()}\n\n${content}`;
      if (format === 'copy-markdown') {
        await copyMarkdown(fullContent);
      } else {
        downloadMarkdown(fullContent, bookmark.title);
      }
    } else {
      downloadHtml(bookmark.html || '<p>No content available</p>', bookmark.title);
    }
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export';
  }
}

async function handleDelete(): Promise<void> {
  if (bookmarkId === null) return;
  // eslint-disable-next-line no-alert
  if (!confirm('Delete this bookmark?')) return;

  await deleteBookmarkWithData(bookmarkId);

  if (__IS_WEB__) {
    try {
      const client = await ServerApiClient.fromSettings();
      await client.deleteBookmark(bookmarkId);
    } catch {
      // Best-effort server delete
    }
  }

  window.location.href = '../library/library.html';
}

async function handleRetry(): Promise<void> {
  if (bookmarkId === null) return;

  retryBtn.disabled = true;
  retryBtn.textContent = 'Retrying...';

  try {
    if (__IS_WEB__) {
      const client = await ServerApiClient.fromSettings();
      await client.updateBookmark(bookmarkId, { html: '' });
      await serverSync.incrementalSync();
    } else {
      await retryBookmark(bookmarkId);
      await chrome.runtime.sendMessage({
        type: 'bookmark:retry',
        data: { trigger: 'user_manual' }
      });
    }

    window.location.href = '../library/library.html';
  } catch (error) {
    console.error('Failed to retry bookmark:', error);
    // eslint-disable-next-line no-alert
    alert('Failed to retry bookmark. Please try again.');
  } finally {
    retryBtn.disabled = false;
    retryBtn.textContent = 'Retry';
  }
}

async function handleDebug(): Promise<void> {
  if (bookmarkId === null) return;
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) return;
  // eslint-disable-next-line no-alert
  alert(`HTML Length: ${bookmark.html.length} chars\nStatus: ${bookmark.status}\n\n${bookmark.html.slice(0, 500)}...`);
}

exportBtn.addEventListener('click', () => showExportMenu());
deleteBtn.addEventListener('click', () => void handleDelete());
retryBtn.addEventListener('click', () => void handleRetry());
debugBtn.addEventListener('click', () => void handleDebug());

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

  let { markdown, qaPairs } = await getBookmarkContent(bookmarkId);

  if (!markdown && __IS_WEB__) {
    try {
      await serverSync.fetchBookmarkContent(bookmarkId);
      ({ markdown, qaPairs } = await getBookmarkContent(bookmarkId));
    } catch {
      // Server content not available yet
    }
  }

  document.title = `${bookmark.title} - Bookmarks by Localforge`;
  viewTitle.textContent = bookmark.title;

  const urlLink = createElement('a', {
    href: bookmark.url,
    target: '_blank',
    textContent: bookmark.url,
    style: { color: 'var(--accent-link)' }
  });
  viewMeta.appendChild(urlLink);
  viewMeta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)} · ${bookmark.status}`));

  if (bookmark.status === 'error' && bookmark.errorMessage !== undefined && bookmark.errorMessage !== '') {
    const errorDiv = createElement('div', {
      style: {
        marginTop: 'var(--space-2)',
        padding: 'var(--space-3)',
        backgroundColor: 'var(--danger-bg, #fef2f2)',
        color: 'var(--danger-text, #dc2626)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-sm)',
      },
      textContent: bookmark.errorMessage,
    });
    viewMeta.appendChild(errorDiv);
  }

  retryBtn.classList.toggle('hidden', bookmark.status !== 'error');

  await createTagEditor({
    bookmarkId,
    container: tagEditorContainer,
  });

  const summary = await db.summaries.where('bookmarkId').equals(bookmarkId).first();
  if (summary) {
    summaryContent.textContent = summary.content;
    summarySection.classList.remove('hidden');
  }

  if (markdown) {
    const content = createElement('div', { className: 'markdown-content' });
    setSanitizedHTML(content, parseMarkdown(markdown.content));
    markdownSection.appendChild(content);
  }

  if (qaPairs.length > 0) {
    const qaContainer = createElement('div', { className: 'qa-section' });
    qaContainer.appendChild(createElement('h2', { textContent: `Q&A PAIRS (${qaPairs.length})` }));

    const qaFragment = document.createDocumentFragment();
    for (const qa of qaPairs) {
      const pair = createElement('div', { className: 'qa-pair' });
      pair.appendChild(createElement('div', { className: 'qa-question', textContent: `Q: ${qa.question}` }));
      pair.appendChild(createElement('div', { className: 'qa-answer', textContent: `A: ${qa.answer}` }));
      qaFragment.appendChild(pair);
    }
    qaContainer.appendChild(qaFragment);
    qaSection.appendChild(qaContainer);
  }

  viewContent.classList.remove('hidden');
}

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));

void loadView();
