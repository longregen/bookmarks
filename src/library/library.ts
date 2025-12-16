import { db, BookmarkTag } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatDateByAge } from '../lib/date-format';
import { exportSingleBookmark, downloadExport } from '../lib/export';
import { createTagEditor } from '../lib/tag-editor';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';
import { createHealthIndicator } from '../lib/health-indicator';

let selectedTag = 'All';
let sortBy = 'newest';
let currentBookmarkId: string | null = null;

const tagList = document.getElementById('tagList')!;
const bookmarkList = document.getElementById('bookmarkList')!;
const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;
const detailPanel = document.getElementById('detailPanel')!;
const detailBackdrop = document.getElementById('detailBackdrop')!;
const detailContent = document.getElementById('detailContent')!;
const closeDetailBtn = document.getElementById('closeDetailBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const debugBtn = document.getElementById('debugBtn') as HTMLButtonElement;

sortSelect.addEventListener('change', () => {
  sortBy = sortSelect.value;
  loadBookmarks();
});

closeDetailBtn.addEventListener('click', closeDetail);
detailBackdrop.addEventListener('click', closeDetail);
deleteBtn.addEventListener('click', deleteCurrentBookmark);
exportBtn.addEventListener('click', exportCurrentBookmark);
debugBtn.addEventListener('click', debugCurrentBookmark);

async function loadTags() {
  const bookmarks = await db.bookmarks.toArray();
  const allTags: { [key: string]: number } = {};

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray() || [];
    for (const tag of tags) {
      allTags[tag.tagName] = (allTags[tag.tagName] || 0) + 1;
    }
  }

  const untaggedCount = bookmarks.length - Object.values(allTags).reduce((sum, count) => sum + count, 0);

  tagList.innerHTML = '';

  const allTag = createElement('div', { className: `tag-item ${selectedTag === 'All' ? 'active' : ''}` });
  allTag.onclick = () => selectTag('All');
  allTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'All' }));
  allTag.appendChild(createElement('span', { className: 'tag-count', textContent: bookmarks.length.toString() }));
  tagList.appendChild(allTag);

  if (untaggedCount > 0) {
    const untaggedTag = createElement('div', { className: `tag-item ${selectedTag === 'Untagged' ? 'active' : ''}` });
    untaggedTag.onclick = () => selectTag('Untagged');
    untaggedTag.appendChild(createElement('span', { className: 'tag-name', textContent: 'Untagged' }));
    untaggedTag.appendChild(createElement('span', { className: 'tag-count', textContent: untaggedCount.toString() }));
    tagList.appendChild(untaggedTag);
  }

  tagList.appendChild(createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-3) 0' } }));

  for (const [tagName, count] of Object.entries(allTags).sort()) {
    const tagItem = createElement('div', { className: `tag-item ${selectedTag === tagName ? 'active' : ''}` });
    tagItem.onclick = () => selectTag(tagName);
    tagItem.appendChild(createElement('span', { className: 'tag-name', textContent: `#${tagName}` }));
    tagItem.appendChild(createElement('span', { className: 'tag-count', textContent: count.toString() }));
    tagList.appendChild(tagItem);
  }
}

function selectTag(tag: string) {
  selectedTag = tag;
  loadTags();
  loadBookmarks();
}

async function loadBookmarks() {
  let bookmarks = await db.bookmarks.toArray();

  if (selectedTag !== 'All') {
    if (selectedTag === 'Untagged') {
      const taggedIds = new Set((await db.bookmarkTags.toArray() || []).map(t => t.bookmarkId));
      bookmarks = bookmarks.filter(b => !taggedIds.has(b.id));
    } else {
      const taggedIds = new Set((await db.bookmarkTags.where('tagName').equals(selectedTag).toArray() || []).map(t => t.bookmarkId));
      bookmarks = bookmarks.filter(b => taggedIds.has(b.id));
    }
  }

  if (sortBy === 'newest') bookmarks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  else if (sortBy === 'oldest') bookmarks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  else if (sortBy === 'title') bookmarks.sort((a, b) => a.title.localeCompare(b.title));

  bookmarkList.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarkList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No bookmarks found' }));
    return;
  }

  for (const bookmark of bookmarks) {
    const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmark.id).toArray() || [];
    const card = createElement('div', { className: 'bookmark-card' });
    card.onclick = () => showDetail(bookmark.id);

    const header = createElement('div', { className: 'card-header' });
    header.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));
    header.appendChild(createElement('div', { className: `status-dot status-${bookmark.status}` }));
    card.appendChild(header);

    const meta = createElement('div', { className: 'card-meta' });
    const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
    url.onclick = (e) => e.stopPropagation();
    meta.appendChild(url);
    meta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)}`));
    card.appendChild(meta);

    if (tags.length > 0) {
      const tagContainer = createElement('div', { className: 'card-tags' });
      for (const tag of tags) {
        tagContainer.appendChild(createElement('span', { className: 'tag-badge', textContent: `#${tag.tagName}` }));
      }
      card.appendChild(tagContainer);
    }

    bookmarkList.appendChild(card);
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
  meta.appendChild(document.createTextNode(` · ${formatDateByAge(bookmark.createdAt)} · ${bookmark.status}`));
  detailContent.appendChild(meta);

  const tagEditorContainer = createElement('div', { style: { marginBottom: 'var(--space-6)' } });
  detailContent.appendChild(tagEditorContainer);
  await createTagEditor({ bookmarkId, container: tagEditorContainer, onTagsChange: () => { loadTags(); loadBookmarks(); } });

  detailContent.appendChild(createElement('hr', { style: { border: 'none', borderTop: '1px solid var(--border-primary)', margin: 'var(--space-6) 0' } }));

  if (markdown) {
    const content = createElement('div', { className: 'markdown-content' });
    content.innerHTML = marked(markdown.content);
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
  loadTags();
  loadBookmarks();
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
  alert(`HTML Length: ${bookmark.html.length} chars\nStatus: ${bookmark.status}\n\n${bookmark.html.slice(0, 500)}...`);
}

function marked(text: string): string {
  return text
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
    .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

initTheme();
onThemeChange((theme) => applyTheme(theme));
loadTags();
loadBookmarks();
setInterval(() => { loadTags(); loadBookmarks(); }, 5000);

// Initialize health indicator
const healthIndicatorContainer = document.getElementById('healthIndicator');
if (healthIndicatorContainer) {
  createHealthIndicator(healthIndicatorContainer);
}
