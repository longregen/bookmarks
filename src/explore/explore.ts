import { db, Bookmark, QuestionAnswer } from '../db/schema';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';

// UI Elements
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

const listViewBtn = document.getElementById('listViewBtn') as HTMLButtonElement;
const searchViewBtn = document.getElementById('searchViewBtn') as HTMLButtonElement;

const listView = document.getElementById('listView') as HTMLDivElement;
const searchView = document.getElementById('searchView') as HTMLDivElement;
const detailView = document.getElementById('detailView') as HTMLDivElement;

const bookmarkList = document.getElementById('bookmarkList') as HTMLDivElement;
const searchResults = document.getElementById('searchResults') as HTMLDivElement;
const detailContent = document.getElementById('detailContent') as HTMLDivElement;

const bookmarkCount = document.getElementById('bookmarkCount') as HTMLSpanElement;
const searchCount = document.getElementById('searchCount') as HTMLSpanElement;

const closeDetailBtn = document.getElementById('closeDetailBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;

let currentBookmarkId: string | null = null;

// View switching
listViewBtn.addEventListener('click', () => {
  switchView('list');
});

searchViewBtn.addEventListener('click', () => {
  switchView('search');
});

function switchView(view: 'list' | 'search') {
  if (view === 'list') {
    listView.classList.add('active');
    searchView.classList.remove('active');
    listViewBtn.classList.add('active');
    searchViewBtn.classList.remove('active');
  } else {
    listView.classList.remove('active');
    searchView.classList.add('active');
    listViewBtn.classList.remove('active');
    searchViewBtn.classList.add('active');
  }
}

// Load and display bookmarks
async function loadBookmarks() {
  try {
    const bookmarks = await db.bookmarks.orderBy('createdAt').reverse().toArray();
    bookmarkCount.textContent = bookmarks.length.toString();

    if (bookmarks.length === 0) {
      bookmarkList.innerHTML = '<div class="empty-state">No bookmarks yet. Start by saving a page!</div>';
      return;
    }

    bookmarkList.innerHTML = '';

    for (const bookmark of bookmarks) {
      const card = createBookmarkCard(bookmark);
      bookmarkList.appendChild(card);
    }
  } catch (error) {
    console.error('Error loading bookmarks:', error);
    bookmarkList.innerHTML = '<div class="error-message">Failed to load bookmarks</div>';
  }
}

function createBookmarkCard(bookmark: Bookmark): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.addEventListener('click', () => showBookmarkDetail(bookmark.id));

  const statusClass = `status-${bookmark.status}`;
  const statusText = bookmark.status.charAt(0).toUpperCase() + bookmark.status.slice(1);

  const timeAgo = getTimeAgo(bookmark.createdAt);

  card.innerHTML = `
    <div class="bookmark-header">
      <div>
        <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
        <a href="${escapeHtml(bookmark.url)}" class="bookmark-url">${escapeHtml(bookmark.url)}</a>
      </div>
      <span class="status-badge ${statusClass}">${statusText}</span>
    </div>
    <div class="bookmark-meta">
      <span>${timeAgo}</span>
    </div>
    ${bookmark.errorMessage ? `<div class="error-message">${escapeHtml(bookmark.errorMessage)}${bookmark.errorStack ? `<pre class="error-stack">${escapeHtml(bookmark.errorStack)}</pre>` : ''}</div>` : ''}
  `;

  // Add event listener to stop propagation on link clicks (CSP-compliant)
  const link = card.querySelector('.bookmark-url');
  if (link) {
    link.addEventListener('click', (e) => e.stopPropagation());
  }

  return card;
}

async function showBookmarkDetail(bookmarkId: string) {
  currentBookmarkId = bookmarkId;

  try {
    const bookmark = await db.bookmarks.get(bookmarkId);
    if (!bookmark) {
      alert('Bookmark not found');
      return;
    }

    const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
    const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

    detailContent.innerHTML = `
      <h1>${escapeHtml(bookmark.title)}</h1>
      <div class="bookmark-meta" style="margin-bottom: 24px;">
        <a href="${escapeHtml(bookmark.url)}" target="_blank" class="bookmark-url">${escapeHtml(bookmark.url)}</a>
        <span class="status-badge status-${bookmark.status}">${bookmark.status}</span>
        <span>${getTimeAgo(bookmark.createdAt)}</span>
      </div>

      ${markdown ? `
        <div class="markdown-content">
          ${marked(markdown.content)}
        </div>
      ` : '<p>Content not yet extracted.</p>'}

      ${qaPairs.length > 0 ? `
        <div class="qa-section">
          <h2>Generated Q&A Pairs (${qaPairs.length})</h2>
          ${qaPairs.map(qa => `
            <div class="qa-pair">
              <div class="qa-question">Q: ${escapeHtml(qa.question)}</div>
              <div class="qa-answer">A: ${escapeHtml(qa.answer)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // Show/hide retry button based on status
    if (bookmark.status === 'error') {
      retryBtn.classList.remove('hidden');
    } else {
      retryBtn.classList.add('hidden');
    }

    detailView.classList.remove('hidden');
  } catch (error) {
    console.error('Error showing bookmark detail:', error);
    alert('Failed to load bookmark details');
  }
}

function closeDetail() {
  detailView.classList.add('hidden');
  currentBookmarkId = null;
}

async function deleteCurrentBookmark() {
  if (!currentBookmarkId) return;

  if (!confirm('Are you sure you want to delete this bookmark?')) {
    return;
  }

  try {
    // Delete associated records
    await db.markdown.where('bookmarkId').equals(currentBookmarkId).delete();
    await db.questionsAnswers.where('bookmarkId').equals(currentBookmarkId).delete();
    await db.bookmarks.delete(currentBookmarkId);

    closeDetail();
    await loadBookmarks();
  } catch (error) {
    console.error('Error deleting bookmark:', error);
    alert('Failed to delete bookmark');
  }
}

async function retryCurrentBookmark() {
  if (!currentBookmarkId) return;

  try {
    await db.bookmarks.update(currentBookmarkId, {
      status: 'pending',
      errorMessage: undefined,
      errorStack: undefined,
      updatedAt: new Date(),
    });

    closeDetail();
    await loadBookmarks();

    // Notify service worker to process
    chrome.runtime.sendMessage({ type: 'START_PROCESSING' });
  } catch (error) {
    console.error('Error retrying bookmark:', error);
    alert('Failed to retry bookmark');
  }
}

// Search functionality
async function performSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.innerHTML = '<div class="empty-state">Enter a search query to find bookmarks</div>';
    return;
  }

  try {
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';

    // Generate embedding for the query
    const [queryEmbedding] = await generateEmbeddings([query]);

    // Load all Q&A pairs with embeddings
    const allQAs = await db.questionsAnswers.toArray();

    if (allQAs.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No processed bookmarks to search yet</div>';
      return;
    }

    // Find top K similar Q&A pairs using both question and combined embeddings
    // Filter out items with missing or invalid embeddings
    const items = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion },
      { item: qa, embedding: qa.embeddingBoth },
    ]).filter(({ embedding }) =>
      Array.isArray(embedding) &&
      embedding.length > 0 &&
      embedding.length === queryEmbedding.length
    );

    if (items.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No valid embeddings found. Try reprocessing your bookmarks.</div>';
      return;
    }

    const topResults = findTopK(queryEmbedding, items, 20);

    // Group by bookmark and get unique bookmarks
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      if (result.score < 0.5) continue; // Skip low similarity results

      const bookmarkId = result.item.bookmarkId;
      if (!bookmarkMap.has(bookmarkId)) {
        bookmarkMap.set(bookmarkId, []);
      }
      bookmarkMap.get(bookmarkId)!.push({ qa: result.item, score: result.score });
    }

    if (bookmarkMap.size === 0) {
      searchResults.innerHTML = '<div class="empty-state">No results found</div>';
      searchCount.textContent = '0';
      return;
    }

    searchResults.innerHTML = '';
    searchCount.textContent = bookmarkMap.size.toString();

    // Display results
    for (const [bookmarkId, qaResults] of bookmarkMap.entries()) {
      const bookmark = await db.bookmarks.get(bookmarkId);
      if (!bookmark) continue;

      const card = createSearchResultCard(bookmark, qaResults);
      searchResults.appendChild(card);
    }

    switchView('search');
  } catch (error) {
    console.error('Error performing search:', error);
    searchResults.innerHTML = `<div class="error-message">Search failed: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

function createSearchResultCard(
  bookmark: Bookmark,
  qaResults: { qa: QuestionAnswer; score: number }[]
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'search-result-card';
  card.addEventListener('click', () => showBookmarkDetail(bookmark.id));

  const bestScore = Math.max(...qaResults.map(r => r.score));
  const topQA = qaResults[0].qa;

  card.innerHTML = `
    <span class="similarity-score">${(bestScore * 100).toFixed(0)}% match</span>
    <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
    <a href="${escapeHtml(bookmark.url)}" class="bookmark-url">${escapeHtml(bookmark.url)}</a>
    <div class="qa-pair">
      <div class="qa-question">${escapeHtml(topQA.question)}</div>
      <div class="qa-answer">${escapeHtml(topQA.answer)}</div>
    </div>
  `;

  // Add event listener to stop propagation on link clicks (CSP-compliant)
  const link = card.querySelector('.bookmark-url');
  if (link) {
    link.addEventListener('click', (e) => e.stopPropagation());
  }

  return card;
}

// Event listeners
closeDetailBtn.addEventListener('click', closeDetail);
deleteBtn.addEventListener('click', deleteCurrentBookmark);
retryBtn.addEventListener('click', retryCurrentBookmark);
settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
searchBtn.addEventListener('click', performSearch);

searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Simple markdown renderer (basic implementation)
function marked(markdown: string): string {
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
    // Code blocks
    .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

// Initialize
loadBookmarks();

// Refresh bookmarks every 5 seconds
setInterval(loadBookmarks, 5000);
