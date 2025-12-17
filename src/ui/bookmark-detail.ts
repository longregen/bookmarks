import { db, getBookmarkContent } from '../db/schema';
import { createElement } from './dom';
import { formatDateByAge } from '../lib/date-format';
import { exportSingleBookmark } from '../lib/export';
import { downloadExport } from './export-download';
import { createTagEditor } from './tag-editor';
import { parseMarkdown } from '../lib/markdown';

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
  }

  async showDetail(bookmarkId: string): Promise<void> {
    this.currentBookmarkId = bookmarkId;
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) return;

    const { markdown, qaPairs } = await getBookmarkContent(bookmarkId);

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
      content.innerHTML = parseMarkdown(markdown.content);
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

  closeDetail(): void {
    this.config.detailPanel.classList.remove('active');
    this.config.detailBackdrop.classList.remove('active');
    this.currentBookmarkId = null;
  }

  async deleteCurrentBookmark(): Promise<void> {
    // eslint-disable-next-line no-alert
    if (this.currentBookmarkId === null || !confirm('Delete this bookmark?')) return;

    await db.markdown.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.questionsAnswers.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.bookmarkTags.where('bookmarkId').equals(this.currentBookmarkId).delete();
    await db.bookmarks.delete(this.currentBookmarkId);

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
}
