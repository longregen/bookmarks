import { db, type BookmarkTag } from '../db/schema';
import { createElement, getElement } from '../ui/dom';
import { formatDateByAge } from '../lib/date-format';
import { getErrorMessage } from '../lib/errors';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../ui/init-extension';
import { initWebWithAuth } from '../web/init-web';
import { createHealthIndicator } from '../ui/health-indicator';
import { BookmarkDetailManager } from '../ui/bookmark-detail';
import { loadTagFilters } from '../ui/tag-filter';
import { config } from '../lib/config-registry';
import { addEventListener as addBookmarkEventListener } from '../lib/events';
import { getHostname } from '../lib/url-validator';

const selectedTags = new Set<string>();

function getStatusModifier(status: string): string {
  const statusMap: Record<string, string> = {
    'complete': 'status-dot--success',
    'pending': 'status-dot--warning',
    'processing': 'status-dot--info',
    'error': 'status-dot--error'
  };
  return statusMap[status] || 'status-dot--warning';
}

const tagFilters = getElement('tagFilters');
const stumbleList = getElement('stumbleList');
const shuffleBtn = getElement<HTMLButtonElement>('shuffleBtn');
const resultCount = getElement('resultCount');

const detailPanel = getElement('detailPanel');
const detailBackdrop = getElement('detailBackdrop');
const detailContent = getElement('detailContent');

const detailManager = new BookmarkDetailManager({
  detailPanel,
  detailBackdrop,
  detailContent,
  closeBtn: getElement<HTMLButtonElement>('closeDetailBtn'),
  deleteBtn: getElement<HTMLButtonElement>('deleteBtn'),
  exportBtn: getElement<HTMLButtonElement>('exportBtn'),
  debugBtn: getElement<HTMLButtonElement>('debugBtn'),
  retryBtn: getElement<HTMLButtonElement>('retryBtn'),
  onDelete: () => void loadStumble(),
  onTagsChange: () => void loadFilters(),
  onRetry: () => void loadStumble()
});

shuffleBtn.addEventListener('click', () => void loadStumble());

async function loadFilters(): Promise<void> {
  await loadTagFilters({
    container: tagFilters,
    selectedTags,
    onChange: () => {
      void loadFilters();
      void loadStumble();
    }
  });
}

async function loadStumble(): Promise<void> {
  shuffleBtn.disabled = true;
  shuffleBtn.textContent = 'Shuffling...';

  try {
    let bookmarks = await db.bookmarks.where('status').equals('complete').toArray();

    if (selectedTags.size > 0) {
      // Use anyOf for single query instead of N queries
      const tagResults = await db.bookmarkTags
        .where('tagName')
        .anyOf(Array.from(selectedTags))
        .toArray();
      const taggedIds = new Set(tagResults.map((t: BookmarkTag) => t.bookmarkId));
      bookmarks = bookmarks.filter(b => taggedIds.has(b.id));
    }

    for (let i = bookmarks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bookmarks[i], bookmarks[j]] = [bookmarks[j], bookmarks[i]];
    }

    const selected = bookmarks.slice(0, config.STUMBLE_COUNT);
    resultCount.textContent = selected.length.toString();

    stumbleList.replaceChildren();

    if (selected.length === 0) {
      stumbleList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No complete bookmarks to stumble through' }));
      return;
    }

    const bookmarkIds = selected.map(b => b.id);
    const allMarkdown = await db.markdown.where('bookmarkId').anyOf(bookmarkIds).toArray();
    const markdownByBookmark = new Map<string, string>();
    for (const md of allMarkdown) {
      markdownByBookmark.set(md.bookmarkId, md.content);
    }

    for (const bookmark of selected) {
      const markdownContent = markdownByBookmark.get(bookmark.id);

      const card = createElement('div', { className: 'stumble-card' });
      card.onclick = () => detailManager.showDetail(bookmark.id);

      const header = createElement('div', { className: 'card-header' });
      header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
      header.appendChild(createElement('div', { className: `status-dot ${getStatusModifier(bookmark.status)}` }));
      card.appendChild(header);

      const meta = createElement('div', { className: 'card-meta' });
      const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: getHostname(bookmark.url) });
      url.onclick = (e) => e.stopPropagation();
      meta.appendChild(url);
      card.appendChild(meta);

      const savedAgo = createElement('div', { className: 'saved-ago', textContent: `Saved ${formatDateByAge(bookmark.createdAt)}` });
      card.appendChild(savedAgo);

      if (markdownContent !== undefined && markdownContent.length > 0) {
        const summary = markdownContent.slice(0, 200).trim() + (markdownContent.length > 200 ? '...' : '');
        const preview = createElement('div', { className: 'qa-preview', style: { marginTop: 'var(--space-3)' } });
        preview.appendChild(createElement('div', { className: 'qa-a', textContent: summary }));
        card.appendChild(preview);
      }

      stumbleList.appendChild(card);
    }
  } catch (error) {
    console.error('Stumble error:', error);
    stumbleList.replaceChildren();
    stumbleList.appendChild(createElement('div', { className: 'error-message', textContent: `Failed to load: ${getErrorMessage(error)}` }));
  } finally {
    shuffleBtn.disabled = false;
    shuffleBtn.textContent = '↻ Shuffle';
  }
}

if (__IS_WEB__) {
  void initWebWithAuth();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));
void loadFilters();
void loadStumble();

let healthCleanup: (() => void) | null = null;
const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  healthCleanup = createHealthIndicator(healthIndicatorContainer);
}

const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type.startsWith('tag:')) {
    void loadFilters();
  }
});

window.addEventListener('beforeunload', () => {
  removeEventListener();
  healthCleanup?.();
});
