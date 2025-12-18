import { db, getBookmarkContent } from '../db/schema';
import { createElement, setSanitizedHTML } from './dom';
import { formatDateByAge } from '../lib/date-format';
import { exportSingleBookmark } from '../lib/export';
import { downloadExport } from './export-download';
import { createTagEditor } from './tag-editor';
import { parseMarkdown } from '../lib/markdown';
import { retryBookmark, deleteBookmarkWithData } from '../lib/jobs';

export interface BookmarkDetailConfig {
  detailPanel: HTMLElement;
  detailBackdrop: HTMLElement;
  detailContent: HTMLElement;
  closeBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  debugBtn: HTMLButtonElement;
  retryBtn?: HTMLButtonElement;
  onDelete?: () => void;
  onTagsChange?: () => void;
  onRetry?: () => void;
}

export class BookmarkDetailManager {
  private config: BookmarkDetailConfig;
  private currentBookmarkId: string | null = null;

  constructor(config: BookmarkDetailConfig) {
    this.config = config;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.config.closeBtn.addEventListener('click', () => this.closeDetail());
    this.config.detailBackdrop.addEventListener('click', () => this.closeDetail());
    this.config.deleteBtn.addEventListener('click', () => this.deleteCurrentBookmark());
    this.config.exportBtn.addEventListener('click', () => this.exportCurrentBookmark());
    this.config.debugBtn.addEventListener('click', () => this.debugCurrentBookmark());
    if (this.config.retryBtn) {
      this.config.retryBtn.addEventListener('click', () => this.retryCurrentBookmark());
    }
  }

  async showDetail(bookmarkId: string): Promise<void> {
    this.currentBookmarkId = bookmarkId;
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) return;

    const { markdown, qaPairs } = await getBookmarkContent(bookmarkId);

    // Show/hide retry button based on status
    if (this.config.retryBtn) {
      this.config.retryBtn.style.display = bookmark.status === 'error' ? '' : 'none';
    }

    // Build all content in a document fragment to minimize DOM reflows
    const fragment = document.createDocumentFragment();

    fragment.appendChild(
      createElement('h1', { textContent: bookmark.title, style: { marginTop: '0' } })
    );

    const meta = createElement('div', {
      style: { marginBottom: 'var(--space-6)', color: 'var(--text-tertiary)' }
    });
    const url = createElement('a', {
      href: bookmark.url,
      target: '_blank',
      textContent: bookmark.url,
      style: { color: 'var(--accent-link)' }
    });
    meta.appendChild(url);
    meta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)} · ${bookmark.status}`));

    // Show error message if present
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
      meta.appendChild(errorDiv);
    }

    fragment.appendChild(meta);

    const tagEditorContainer = createElement('div', { style: { marginBottom: 'var(--space-6)' } });
    fragment.appendChild(tagEditorContainer);

    fragment.appendChild(
      createElement('hr', {
        style: {
          border: 'none',
          borderTop: '1px solid var(--border-primary)',
          margin: 'var(--space-6) 0'
        }
      })
    );

    if (markdown) {
      const content = createElement('div', { className: 'markdown-content' });
      setSanitizedHTML(content, parseMarkdown(markdown.content));
      fragment.appendChild(content);
    }

    if (qaPairs.length > 0) {
      const qaSection = createElement('div', { className: 'qa-section' });
      qaSection.appendChild(createElement('h2', { textContent: `Q&A PAIRS (${qaPairs.length})` }));

      // Use inner fragment for QA pairs to batch nested appends
      const qaFragment = document.createDocumentFragment();
      for (const qa of qaPairs) {
        const pair = createElement('div', { className: 'qa-pair' });
        pair.appendChild(createElement('div', { className: 'qa-question', textContent: `Q: ${qa.question}` }));
        pair.appendChild(createElement('div', { className: 'qa-answer', textContent: `A: ${qa.answer}` }));
        qaFragment.appendChild(pair);
      }
      qaSection.appendChild(qaFragment);
      fragment.appendChild(qaSection);
    }

    // Single DOM operation to update content
    this.config.detailContent.innerHTML = '';
    this.config.detailContent.appendChild(fragment);

    // Create tag editor after content is in DOM
    await createTagEditor({
      bookmarkId,
      container: tagEditorContainer,
      onTagsChange: () => this.config.onTagsChange?.()
    });

    this.config.detailPanel.classList.add('active');
    this.config.detailBackdrop.classList.add('active');
  }

  closeDetail(): void {
    this.config.detailPanel.classList.remove('active');
    this.config.detailBackdrop.classList.remove('active');
    this.currentBookmarkId = null;
  }

  async deleteCurrentBookmark(): Promise<void> {
    // eslint-disable-next-line no-alert
    if (this.currentBookmarkId === null || !confirm('Delete this bookmark?')) return;

    await deleteBookmarkWithData(this.currentBookmarkId);

    this.closeDetail();
    this.config.onDelete?.();
  }

  async exportCurrentBookmark(): Promise<void> {
    if (this.currentBookmarkId === null) return;

    this.config.exportBtn.disabled = true;
    this.config.exportBtn.textContent = 'Exporting...';
    try {
      const data = await exportSingleBookmark(this.currentBookmarkId);
      downloadExport(data);
    } finally {
      this.config.exportBtn.disabled = false;
      this.config.exportBtn.textContent = 'Export';
    }
  }

  async debugCurrentBookmark(): Promise<void> {
    if (this.currentBookmarkId === null) return;

    const bookmark = await db.bookmarks.get(this.currentBookmarkId);
    if (!bookmark) return;

    // eslint-disable-next-line no-alert
    alert(`HTML Length: ${bookmark.html.length} chars\nStatus: ${bookmark.status}\n\n${bookmark.html.slice(0, 500)}...`);
  }

  async retryCurrentBookmark(): Promise<void> {
    if (this.currentBookmarkId === null) return;

    const retryBtn = this.config.retryBtn;
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying...';
    }

    try {
      await retryBookmark(this.currentBookmarkId);

      // Trigger the processing queue
      await chrome.runtime.sendMessage({
        type: 'bookmark:retry',
        data: { trigger: 'user_manual' }
      });

      this.closeDetail();
      this.config.onRetry?.();
    } catch (error) {
      console.error('Failed to retry bookmark:', error);
      // eslint-disable-next-line no-alert
      alert('Failed to retry bookmark. Please try again.');
    } finally {
      if (retryBtn) {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry';
      }
    }
  }
}
