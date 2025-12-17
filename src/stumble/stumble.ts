import { db, type BookmarkTag, getBookmarkQAPairs } from '../db/schema';
import { createElement, getElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initWeb } from '../web/init-web';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';
import { loadTagFilters } from '../lib/tag-filter';
import { config } from '../lib/config-registry';
import { addEventListener as addBookmarkEventListener } from '../lib/events';

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
  onDelete: () => void loadStumble(),
  onTagsChange: () => void loadFilters()
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
      const taggedIds = new Set<string>();
      for (const tag of selectedTags) {
        const tagged = await db.bookmarkTags.where('tagName').equals(tag).toArray();
        tagged.forEach((t: BookmarkTag) => taggedIds.add(t.bookmarkId));
      }
      bookmarks = bookmarks.filter(b => taggedIds.has(b.id));
    }

    // Fisher-Yates shuffle
    for (let i = bookmarks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bookmarks[i], bookmarks[j]] = [bookmarks[j], bookmarks[i]];
    }

    const selected = bookmarks.slice(0, config.STUMBLE_COUNT);
    resultCount.textContent = selected.length.toString();

    stumbleList.innerHTML = '';

    if (selected.length === 0) {
      stumbleList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No complete bookmarks to stumble through' }));
      return;
    }

    for (const bookmark of selected) {
      const qaPairs = await getBookmarkQAPairs(bookmark.id);
      const randomQA = qaPairs.length > 0 ? qaPairs[Math.floor(Math.random() * qaPairs.length)] : null;

      const card = createElement('div', { className: 'stumble-card' });
      card.onclick = () => detailManager.showDetail(bookmark.id);

      const header = createElement('div', { className: 'card-header' });
      header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
      header.appendChild(createElement('div', { className: `status-dot ${getStatusModifier(bookmark.status)}` }));
      card.appendChild(header);

      const meta = createElement('div', { className: 'card-meta' });
      const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
      url.onclick = (e) => e.stopPropagation();
      meta.appendChild(url);
      card.appendChild(meta);

      const savedAgo = createElement('div', { className: 'saved-ago', textContent: `Saved ${formatDateByAge(bookmark.createdAt)}` });
      card.appendChild(savedAgo);

      if (randomQA) {
        const qaPreview = createElement('div', { className: 'qa-preview', style: { marginTop: 'var(--space-3)' } });
        qaPreview.appendChild(createElement('div', { className: 'qa-q', textContent: `Q: ${randomQA.question}` }));
        qaPreview.appendChild(createElement('div', { className: 'qa-a', textContent: `A: ${randomQA.answer}` }));
        card.appendChild(qaPreview);
      }

      stumbleList.appendChild(card);
    }
  } catch (error) {
    console.error('Stumble error:', error);
    stumbleList.innerHTML = '';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    stumbleList.appendChild(createElement('div', { className: 'error-message', textContent: `Failed to load: ${errorMessage}` }));
  } finally {
    shuffleBtn.disabled = false;
    shuffleBtn.textContent = '↻ Shuffle';
  }
}

if (__IS_WEB__) {
  void initWeb();
} else {
  void initExtension();
}
onThemeChange((theme) => applyTheme(theme));
void loadFilters();
void loadStumble();

const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}

const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type === 'TAG_UPDATED') {
    void loadFilters();
  }
});

window.addEventListener('beforeunload', () => {
  removeEventListener();
});
