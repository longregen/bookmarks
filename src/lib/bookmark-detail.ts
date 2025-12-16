import { db } from '../db/schema';
import { createElement } from './dom';
import { formatDateByAge } from './date-format';
import { exportSingleBookmark, downloadExport } from './export';
import { createTagEditor } from './tag-editor';
import { parseMarkdown } from './markdown';

/**
 * Renders markdown text to HTML using the marked library
 * @deprecated Use parseMarkdown directly instead
 */
export function renderMarkdown(text: string): string {
  return parseMarkdown(text);
}

/**
 * Configuration for the bookmark detail panel manager
 */
export interface BookmarkDetailConfig {
  detailPanel: HTMLElement;
  detailBackdrop: HTMLElement;
  detailContent: HTMLElement;
  closeBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  debugBtn: HTMLButtonElement;
  onDelete?: () => void;
  onTagsChange?: () => void;
}

/**
 * Manager for bookmark detail panel functionality
 */
export class BookmarkDetailManager {
  private config: BookmarkDetailConfig;
  private currentBookmarkId: string | null = null;

  constructor(config: BookmarkDetailConfig) {
    this.config = config;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.config.closeBtn.addEventListener('click', () => this.closeDetail());
    this.config.detailBackdrop.addEventListener('click', () => this.closeDetail());
    this.config.deleteBtn.addEventListener('click', () => this.deleteCurrentBookmark());
    this.config.exportBtn.addEventListener('click', () => this.exportCurrentBookmark());
    this.config.debugBtn.addEventListener('click', () => this.debugCurrentBookmark());
  }

  /**
   * Shows the detail panel for a bookmark
   */
  async showDetail(bookmarkId: string) {
    this.currentBookmarkId = bookmarkId;
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) return;

    const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
    const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

    this.config.detailContent.innerHTML = '';
    this.config.detailContent.appendChild(
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
    this.config.detailContent.appendChild(meta);

    const tagEditorContainer = createElement('div', { style: { marginBottom: 'var(--space-6)' } });
    this.config.detailContent.appendChild(tagEditorContainer);
    await createTagEditor({
      bookmarkId,
      container: tagEditorContainer,
      onTagsChange: () => this.config.onTagsChange?.()
    });

    this.config.detailContent.appendChild(
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
      content.innerHTML = renderMarkdown(markdown.content);
      this.config.detailContent.appendChild(content);
    }

    if (qaPairs.length > 0) {
      const qaSection = createElement('div', { className: 'qa-section' });
      qaSection.appendChild(createElement('h2', { textContent: `Q&A PAIRS (${qaPairs.length})` }));
      for (const qa of qaPairs) {
        const pair = createElement('div', { className: 'qa-pair' });
        pair.appendChild(createElement('div', { className: 'qa-question', textContent: `Q: ${qa.question}` }));
        pair.appendChild(createElement('div', { className: 'qa-answer', textContent: `A: ${qa.answer}` }));
        qaSection.appendChild(pair);
      }
      this.config.detailContent.appendChild(qaSection);
    }

    this.config.detailPanel.classList.add('active');
    this.config.detailBackdrop.classList.add('active');
  }

  /**
   * Closes the detail panel
   */
  closeDetail() {
    this.config.detailPanel.classList.remove('active');
    this.config.detailBackdrop.classList.remove('active');
    this.currentBookmarkId = null;
  }

  /**
   * Deletes the current bookmark
   */
  async deleteCurrentBookmark() {
    if (!this.currentBookmarkId || !confirm('Delete this bookmark?')) return;

    await db.markdown.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.questionsAnswers.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.bookmarkTags.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.bookmarks.delete(this.currentBookmarkId);

    this.closeDetail();
    this.config.onDelete?.();
  }

  /**
   * Exports the current bookmark
   */
  async exportCurrentBookmark() {
    if (!this.currentBookmarkId) return;

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

  /**
   * Shows debug information for the current bookmark
   */
  async debugCurrentBookmark() {
    if (!this.currentBookmarkId) return;

    const bookmark = await db.bookmarks.get(this.currentBookmarkId);
    if (!bookmark) return;

    alert(`HTML Length: ${bookmark.html.length} chars\nStatus: ${bookmark.status}\n\n${bookmark.html.slice(0, 500)}...`);
  }

  /**
   * Gets the current bookmark ID
   */
  getCurrentBookmarkId(): string | null {
    return this.currentBookmarkId;
  }
}
