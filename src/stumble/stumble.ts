import { db, BookmarkTag } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { exportSingleBookmark, downloadExport } from '../lib/export';
import { createTagEditor } from '../lib/tag-editor';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';

let selectedTags: Set<string> = new Set();
let currentBookmarkId: string | null = null;
const STUMBLE_COUNT = 10;

const tagFilters = document.getElementById('tagFilters')!;
const stumbleList = document.getElementById('stumbleList')!;
const shuffleBtn = document.getElementById('shuffleBtn') as HTMLButtonElement;
const resultCount = document.getElementById('resultCount')!;
const detailPanel = document.getElementById('detailPanel')!;
const detailBackdrop = document.getElementById('detailBackdrop')!;
const detailContent = document.getElementById('detailContent')!;
const closeDetailBtn = document.getElementById('closeDetailBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const debugBtn = document.getElementById('debugBtn') as HTMLButtonElement;

shuffleBtn.addEventListener('click', loadStumble);
closeDetailBtn.addEventListener('click', closeDetail);
detailBackdrop.addEventListener('click', closeDetail);
deleteBtn.addEventListener('click', deleteCurrentBookmark);
exportBtn.addEventListener('click', exportCurrentBookmark);
debugBtn.addEventListener('click', debugCurrentBookmark);

async function loadFilters() {
  const bookmarks = await db.bookmarks.toArray();
  const allTags = new Set<string>();

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray();
    tags.forEach((t: BookmarkTag) => allTags.add(t.tagName));
  }

  tagFilters.innerHTML = '';
  const selectAll = createElement('label', { className: 'filter-item' });
  const selectAllCb = createElement('input', { attributes: { type: 'checkbox', checked: selectedTags.size === 0 ? 'checked' : '' } }) as HTMLInputElement;
  selectAllCb.onchange = () => { selectedTags.clear(); loadFilters(); loadStumble(); };
  selectAll.appendChild(selectAllCb);
  selectAll.appendChild(createElement('span', { textContent: 'Select all' }));
  tagFilters.appendChild(selectAll);

  for (const tag of Array.from(allTags).sort()) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', { attributes: { type: 'checkbox', checked: selectedTags.has(tag) ? 'checked' : '' } }) as HTMLInputElement;
    cb.onchange = () => {
      if (cb.checked) selectedTags.add(tag);
      else selectedTags.delete(tag);
      loadStumble();
    };
    label.appendChild(cb);
    label.appendChild(createElement('span', { textContent: `#${tag}` }));
    tagFilters.appendChild(label);
  }
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
      card.onclick = () => showDetail(bookmark.id);

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

async function showDetail(bookmarkId: string) {
  currentBookmarkId = bookmarkId;
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) return;

  const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

  detailContent.innerHTML = '';
  detailContent.appendChild(createElement('h1', { textContent: bookmark.title, style: { marginTop: '0' } }));

  const meta = createElement('div', { style: { marginBottom: 'var(--space-6)', color: 'var(--text-tertiary)' } });
  const url = createElement('a', { href: bookmark.url, target: '_blank', textContent: bookmark.url, style: { color: 'var(--accent-link)' } });
  meta.appendChild(url);
  meta.appendChild(document.createTextNode(` · Saved ${formatDateByAge(bookmark.createdAt)} · ${bookmark.status}`));
  detailContent.appendChild(meta);

  const tagEditorContainer = createElement('div', { style: { marginBottom: 'var(--space-6)' } });
  detailContent.appendChild(tagEditorContainer);
  await createTagEditor({ bookmarkId, container: tagEditorContainer, onTagsChange: () => loadFilters() });

  detailContent.appendChild(createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-6) 0' } }));

  if (markdown) {
    const content = createElement('div', { className: 'markdown-content' });
    content.innerHTML = markdown.content
      .replace(/^### /gm, '<h3>')
      .replace(/^## /gm, '<h2>')
      .replace(/^# /gm, '<h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    detailContent.appendChild(content);
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
    detailContent.appendChild(qaSection);
  }

  detailPanel.classList.add('active');
  detailBackdrop.classList.add('active');
}

function closeDetail() {
  detailPanel.classList.remove('active');
  detailBackdrop.classList.remove('active');
  currentBookmarkId = null;
}

async function deleteCurrentBookmark() {
  if (!currentBookmarkId || !confirm('Delete this bookmark?')) return;
  await db.markdown.where('bookmarkId').equals(currentBookmarkId).delete();
  await db.questionsAnswers.where('bookmarkId').equals(currentBookmarkId).delete();
  await db.bookmarkTags.where('bookmarkId').equals(currentBookmarkId).delete();
  await db.bookmarks.delete(currentBookmarkId);
  closeDetail();
  loadStumble();
}

async function exportCurrentBookmark() {
  if (!currentBookmarkId) return;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';
  try {
    const data = await exportSingleBookmark(currentBookmarkId);
    downloadExport(data);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export';
  }
}

async function debugCurrentBookmark() {
  if (!currentBookmarkId) return;
  const bookmark = await db.bookmarks.get(currentBookmarkId);
  if (!bookmark) return;
  alert(`HTML: ${bookmark.html.length} chars\nStatus: ${bookmark.status}`);
}

initTheme();
onThemeChange((theme) => applyTheme(theme));
loadFilters();
loadStumble();
