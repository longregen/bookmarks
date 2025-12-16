import { db, BookmarkTag, QuestionAnswer } from '../db/schema';
import { createElement } from '../lib/dom';
import { formatTimeAgoShort } from '../lib/time';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';
import { exportSingleBookmark, downloadExport } from '../lib/export';
import { initTheme, onThemeChange, applyTheme } from '../shared/theme';

let selectedTags: Set<string> = new Set();
let selectedStatuses: Set<string> = new Set(['complete', 'pending', 'processing', 'error']);
let currentBookmarkId: string | null = null;

const tagFilters = document.getElementById('tagFilters')!;
const statusFilters = document.getElementById('statusFilters')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const resultsList = document.getElementById('resultsList')!;
const resultCount = document.getElementById('resultCount')!;
const detailPanel = document.getElementById('detailPanel')!;
const detailBackdrop = document.getElementById('detailBackdrop')!;
const detailContent = document.getElementById('detailContent')!;
const closeDetailBtn = document.getElementById('closeDetailBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const debugBtn = document.getElementById('debugBtn') as HTMLButtonElement;

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });
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
  selectAllCb.onchange = () => { selectedTags.clear(); loadFilters(); };
  selectAll.appendChild(selectAllCb);
  selectAll.appendChild(createElement('span', { textContent: 'Select all' }));
  tagFilters.appendChild(selectAll);

  for (const tag of Array.from(allTags).sort()) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', { attributes: { type: 'checkbox', checked: selectedTags.has(tag) ? 'checked' : '' } }) as HTMLInputElement;
    cb.onchange = () => { if (cb.checked) selectedTags.add(tag); else selectedTags.delete(tag); };
    label.appendChild(cb);
    label.appendChild(createElement('span', { textContent: `#${tag}` }));
    tagFilters.appendChild(label);
  }

  statusFilters.innerHTML = '';
  const statusAll = createElement('label', { className: 'filter-item' });
  const statusAllCb = createElement('input', { attributes: { type: 'checkbox', checked: selectedStatuses.size === 4 ? 'checked' : '' } }) as HTMLInputElement;
  statusAllCb.onchange = () => { selectedStatuses = new Set(['complete', 'pending', 'processing', 'error']); loadFilters(); };
  statusAll.appendChild(statusAllCb);
  statusAll.appendChild(createElement('span', { textContent: 'Select all' }));
  statusFilters.appendChild(statusAll);

  for (const status of ['complete', 'pending', 'error']) {
    const label = createElement('label', { className: 'filter-item' });
    const cb = createElement('input', { attributes: { type: 'checkbox', checked: selectedStatuses.has(status) ? 'checked' : '' } }) as HTMLInputElement;
    cb.onchange = () => { if (cb.checked) selectedStatuses.add(status); else selectedStatuses.delete(status); };
    label.appendChild(cb);
    label.appendChild(createElement('span', { textContent: status.charAt(0).toUpperCase() + status.slice(1) }));
    statusFilters.appendChild(label);
  }
}

async function performSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    resultsList.innerHTML = '';
    resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'Enter a search query' }));
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';

  try {
    const [queryEmbedding] = await generateEmbeddings([query]);
    if (!queryEmbedding?.length) throw new Error('Failed to generate embedding');

    const allQAs = await db.questionsAnswers.toArray();
    const items = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' }
    ]).filter(({ embedding }) => Array.isArray(embedding) && embedding.length === queryEmbedding.length);

    if (!items.length) {
      resultsList.innerHTML = '';
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No embeddings found' }));
      return;
    }

    const topResults = findTopK(queryEmbedding, items, 200);
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      const bookmarkId = result.item.bookmarkId;
      if (!bookmarkMap.has(bookmarkId)) bookmarkMap.set(bookmarkId, []);
      bookmarkMap.get(bookmarkId)!.push({ qa: result.item, score: result.score });
    }

    const sortedResults = Array.from(bookmarkMap.entries())
      .sort((a, b) => Math.max(...b[1].map(r => r.score)) - Math.max(...a[1].map(r => r.score)));

    const filteredResults = [];
    for (const [bookmarkId, qaResults] of sortedResults) {
      const bookmark = await db.bookmarks.get(bookmarkId);
      if (!bookmark || !selectedStatuses.has(bookmark.status)) continue;

      if (selectedTags.size > 0) {
        const tags = await db.bookmarkTags.where('bookmarkId').equals(bookmarkId).toArray();
        if (!tags.some((t: BookmarkTag) => selectedTags.has(t.tagName))) continue;
      }

      filteredResults.push({ bookmark, qaResults });
    }

    resultCount.textContent = filteredResults.length.toString();
    resultsList.innerHTML = '';

    if (!filteredResults.length) {
      resultsList.appendChild(createElement('div', { className: 'empty-state', textContent: 'No results found' }));
      return;
    }

    for (const { bookmark, qaResults } of filteredResults) {
      const maxScore = Math.max(...qaResults.map(r => r.score));
      const bestQA = qaResults[0].qa;

      const card = createElement('div', { className: 'result-card' });
      card.onclick = () => showDetail(bookmark.id);

      card.appendChild(createElement('div', { className: 'relevance', textContent: `${(maxScore * 100).toFixed(0)}% match` }));
      card.appendChild(createElement('div', { className: 'card-title', textContent: bookmark.title }));

      const meta = createElement('div', { className: 'card-meta' });
      const url = createElement('a', { className: 'card-url', href: bookmark.url, textContent: new URL(bookmark.url).hostname });
      url.onclick = (e) => e.stopPropagation();
      meta.appendChild(url);
      meta.appendChild(document.createTextNode(` · ${formatTimeAgoShort(bookmark.createdAt)}`));
      card.appendChild(meta);

      const qaPreview = createElement('div', { className: 'qa-preview' });
      qaPreview.appendChild(createElement('div', { className: 'qa-q', textContent: `Q: ${bestQA.question}` }));
      qaPreview.appendChild(createElement('div', { className: 'qa-a', textContent: `A: ${bestQA.answer}` }));
      card.appendChild(qaPreview);

      resultsList.appendChild(card);
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '';
    resultsList.appendChild(createElement('div', { className: 'error-message', textContent: `Search failed: ${error}` }));
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Search';
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
  meta.appendChild(document.createTextNode(` · ${formatTimeAgoShort(bookmark.createdAt)} · ${bookmark.status}`));
  detailContent.appendChild(meta);

  if (markdown) {
    const content = createElement('div', { className: 'markdown-content' });
    content.innerHTML = markdown.content.replace(/^### /gm, '<h3>').replace(/^## /gm, '<h2>').replace(/^# /gm, '<h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
  performSearch();
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
