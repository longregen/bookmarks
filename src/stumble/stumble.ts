import { db, BookmarkTag } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { onThemeChange, applyTheme } from '../shared/theme';
import { initExtension } from '../lib/init-extension';
import { initWeb } from '../web/init-web';
import { createHealthIndicator } from '../lib/health-indicator';
import { BookmarkDetailManager } from '../lib/bookmark-detail';
import { loadTagFilters } from '../lib/tag-filter';
import { STUMBLE_COUNT } from '../lib/constants';
import { addEventListener as addBookmarkEventListener } from '../lib/events';

let selectedTags: Set<string> = new Set();

const tagFilters = document.getElementById('tagFilters')!;
const stumbleList = document.getElementById('stumbleList')!;
const shuffleBtn = document.getElementById('shuffleBtn') as HTMLButtonElement;
const resultCount = document.getElementById('resultCount')!;

// Initialize bookmark detail manager
const detailManager = new BookmarkDetailManager({
  detailPanel: document.getElementById('detailPanel')!,
  detailBackdrop: document.getElementById('detailBackdrop')!,
  detailContent: document.getElementById('detailContent')!,
  closeBtn: document.getElementById('closeDetailBtn') as HTMLButtonElement,
  deleteBtn: document.getElementById('deleteBtn') as HTMLButtonElement,
  exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
  debugBtn: document.getElementById('debugBtn') as HTMLButtonElement,
  onDelete: () => loadStumble(),
  onTagsChange: () => loadFilters()
});

shuffleBtn.addEventListener('click', loadStumble);

async function loadFilters() {
  // Load tag filters using shared utility
  await loadTagFilters({
    container: tagFilters,
    selectedTags,
    onChange: () => {
      loadFilters();
      loadStumble();
    }
  });
}

async function loadStumble() {
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

    const selected = bookmarks.slice(0, STUMBLE_COUNT);
    resultCount.textContent = selected.length.toString();

    stumbleList.innerHTML = '';

    if (selected.length === 0) {
      stumbleList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No complete bookmarks to stumble through' }));
      return;
    }

    for (const bookmark of selected) {
      const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmark.id).toArray();
      const randomQA = qaPairs.length > 0 ? qaPairs[Math.floor(Math.random() * qaPairs.length)] : null;

      const card = createElement('div', { className: 'stumble-card' });
      card.onclick = () => detailManager.showDetail(bookmark.id);

      const header = createElement('div', { className: 'card-header' });
      header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
      header.appendChild(createElement('div', { className: `status-dot status-${bookmark.status}` }));
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
    stumbleList.appendChild(createElement('div', { className: 'error-message', textContent: `Failed to load: ${error}` }));
  } finally {
    shuffleBtn.disabled = false;
    shuffleBtn.textContent = '↻ Shuffle';
  }
}

// Initialize platform and theme
if (__IS_WEB__) {
  initWeb();
} else {
  initExtension();
}
onThemeChange((theme) => applyTheme(theme));
loadFilters();
loadStumble();

// Initialize health indicator
const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}

// Event-driven updates for tag changes
const removeEventListener = addBookmarkEventListener((event) => {
  if (event.type === 'TAG_UPDATED') {
    loadFilters();
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  removeEventListener();
});
