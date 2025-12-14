import { db, Bookmark, QuestionAnswer } from '../db/schema';
import { generateEmbeddings } from '../lib/api';
import { findTopK } from '../lib/similarity';
import { exportSingleBookmark, exportAllBookmarks, downloadExport } from '../lib/export';

// Constants
const RESULTS_PER_PAGE = 10;

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
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const exportAllBtn = document.getElementById('exportAllBtn') as HTMLButtonElement;
const debugHtmlBtn = document.getElementById('debugHtmlBtn') as HTMLButtonElement;

let currentBookmarkId: string | null = null;

// Search state for pagination
interface SearchResult {
  bookmarkId: string;
  bookmark: Bookmark;
  qaResults: { qa: QuestionAnswer; score: number }[];
}
let currentSearchResults: SearchResult[] = [];
let displayedResultsCount = 0;

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
      <div class="bookmark-header-actions">
        <button class="btn btn-small btn-export" title="Export bookmark">Export</button>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
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

  // Add event listener for per-item export button
  const exportButton = card.querySelector('.btn-export');
  if (exportButton) {
    exportButton.addEventListener('click', (e) => exportBookmarkById(bookmark.id, e));
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

async function debugCurrentBookmarkHtml() {
  if (!currentBookmarkId) return;

  try {
    const bookmark = await db.bookmarks.get(currentBookmarkId);
    if (!bookmark) {
      alert('Bookmark not found');
      return;
    }

    // Show the raw HTML in a modal-style overlay
    const debugOverlay = document.createElement('div');
    debugOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    const debugContent = document.createElement('div');
    debugContent.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 20px;
      max-width: 90%;
      max-height: 90%;
      overflow: auto;
      position: relative;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.className = 'btn btn-secondary';
    closeBtn.style.cssText = `
      position: sticky;
      top: 0;
      margin-bottom: 10px;
    `;
    closeBtn.addEventListener('click', () => debugOverlay.remove());

    const htmlInfo = document.createElement('div');
    htmlInfo.style.cssText = 'margin-bottom: 10px; font-weight: bold;';
    htmlInfo.innerHTML = `
      <div>Raw HTML Length: ${bookmark.html.length} characters</div>
      <div>Status: ${bookmark.status}</div>
      ${bookmark.errorMessage ? `<div style="color: red;">Error: ${escapeHtml(bookmark.errorMessage)}</div>` : ''}
    `;

    const htmlDisplay = document.createElement('pre');
    htmlDisplay.style.cssText = `
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      max-height: 70vh;
      overflow: auto;
    `;
    htmlDisplay.textContent = bookmark.html || '(empty)';

    debugContent.appendChild(closeBtn);
    debugContent.appendChild(htmlInfo);
    debugContent.appendChild(htmlDisplay);
    debugOverlay.appendChild(debugContent);
    document.body.appendChild(debugOverlay);
  } catch (error) {
    console.error('Error debugging HTML:', error);
    alert('Failed to load HTML for debugging');
  }
}

// Export functionality
async function exportCurrentBookmark() {
  if (!currentBookmarkId) return;

  try {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    const exportData = await exportSingleBookmark(currentBookmarkId);
    downloadExport(exportData);
  } catch (error) {
    console.error('Error exporting bookmark:', error);
    alert('Failed to export bookmark');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export';
  }
}

async function exportBookmarkById(bookmarkId: string, event: Event) {
  event.stopPropagation(); // Prevent card click from opening detail view

  const button = event.currentTarget as HTMLButtonElement;
  const originalText = button.textContent;

  try {
    button.disabled = true;
    button.textContent = '...';

    const exportData = await exportSingleBookmark(bookmarkId);
    downloadExport(exportData);
  } catch (error) {
    console.error('Error exporting bookmark:', error);
    alert('Failed to export bookmark');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleExportAll() {
  try {
    exportAllBtn.disabled = true;
    exportAllBtn.textContent = 'Exporting...';

    const exportData = await exportAllBookmarks();

    if (exportData.bookmarkCount === 0) {
      alert('No bookmarks to export');
      return;
    }

    downloadExport(exportData);
  } catch (error) {
    console.error('Error exporting all bookmarks:', error);
    alert('Failed to export bookmarks');
  } finally {
    exportAllBtn.disabled = false;
    exportAllBtn.textContent = 'Export All';
  }
}

// Search functionality
async function performSearch() {
  const query = searchInput.value.trim();

  if (__DEBUG_EMBEDDINGS__) {
    console.log('[Search] Starting search', { query, queryLength: query.length });
  }

  if (!query) {
    searchResults.innerHTML = '<div class="empty-state">Enter a search query to find bookmarks</div>';
    return;
  }

  try {
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';

    // Reset pagination state
    currentSearchResults = [];
    displayedResultsCount = 0;

    // Generate embedding for the query
    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Generating query embedding...');
    }
    const [queryEmbedding] = await generateEmbeddings([query]);

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Query embedding received', {
        exists: !!queryEmbedding,
        isArray: Array.isArray(queryEmbedding),
        dimension: queryEmbedding?.length,
        sample: queryEmbedding?.slice(0, 5),
      });
    }

    if (!queryEmbedding || !Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.error('[Search] Invalid query embedding received!');
      }
      searchResults.innerHTML = '<div class="error-message">Failed to generate query embedding</div>';
      return;
    }

    // Load all Q&A pairs with embeddings
    const allQAs = await db.questionsAnswers.toArray();

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Loaded Q&A pairs from database', {
        totalCount: allQAs.length,
        withQuestionEmbedding: allQAs.filter(qa => Array.isArray(qa.embeddingQuestion) && qa.embeddingQuestion.length > 0).length,
        withBothEmbedding: allQAs.filter(qa => Array.isArray(qa.embeddingBoth) && qa.embeddingBoth.length > 0).length,
      });
    }

    if (allQAs.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No processed bookmarks to search yet</div>';
      return;
    }

    // Find top K similar Q&A pairs using both question and combined embeddings
    // Filter out items with missing or invalid embeddings
    const allItems = allQAs.flatMap(qa => [
      { item: qa, embedding: qa.embeddingQuestion, type: 'question' },
      { item: qa, embedding: qa.embeddingBoth, type: 'both' },
    ]);

    // Detailed filtering with debugging
    const filterResults = __DEBUG_EMBEDDINGS__ ? {
      total: allItems.length,
      notArray: 0,
      emptyArray: 0,
      dimensionMismatch: 0,
      valid: 0,
    } : null;

    const items = allItems.filter(({ embedding }) => {
      if (!Array.isArray(embedding)) {
        if (filterResults) filterResults.notArray++;
        return false;
      }
      if (embedding.length === 0) {
        if (filterResults) filterResults.emptyArray++;
        return false;
      }
      if (embedding.length !== queryEmbedding.length) {
        if (filterResults) filterResults.dimensionMismatch++;
        return false;
      }
      if (filterResults) filterResults.valid++;
      return true;
    });

    if (__DEBUG_EMBEDDINGS__) {
      // Debug: Analyze embedding dimensions in database
      const embeddingDimensions = new Map<number, number>();
      allQAs.forEach(qa => {
        [qa.embeddingQuestion, qa.embeddingBoth, qa.embeddingAnswer].forEach(emb => {
          if (Array.isArray(emb) && emb.length > 0) {
            embeddingDimensions.set(emb.length, (embeddingDimensions.get(emb.length) || 0) + 1);
          }
        });
      });

      console.log('[Search] Embedding dimensions found in database', {
        queryDimension: queryEmbedding.length,
        storedDimensions: Object.fromEntries(embeddingDimensions),
        dimensionMismatch: !embeddingDimensions.has(queryEmbedding.length),
      });

      console.log('[Search] Created items for comparison', {
        totalItems: allItems.length,
        itemsWithValidEmbedding: allItems.filter(i => Array.isArray(i.embedding) && i.embedding.length > 0).length,
      });

      console.log('[Search] Filter results', {
        ...filterResults,
        queryDimension: queryEmbedding.length,
      });
    }

    if (items.length === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.error('[Search] No valid items after filtering!', filterResults);
      }
      searchResults.innerHTML = '<div class="empty-state">No valid embeddings found. Try reprocessing your bookmarks.</div>';
      return;
    }

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Running similarity search on', items.length, 'items');
    }
    // Get more results to allow pagination (up to 100 unique bookmarks worth)
    const topResults = findTopK(queryEmbedding, items, 200);

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Top results from findTopK', {
        resultCount: topResults.length,
        scores: topResults.map(r => r.score.toFixed(4)),
        scoreRange: topResults.length > 0 ? {
          min: Math.min(...topResults.map(r => r.score)).toFixed(4),
          max: Math.max(...topResults.map(r => r.score)).toFixed(4),
        } : null,
      });
    }

    // Group by bookmark and get unique bookmarks (no threshold filtering)
    const bookmarkMap = new Map<string, { qa: QuestionAnswer; score: number }[]>();

    for (const result of topResults) {
      const bookmarkId = result.item.bookmarkId;
      if (!bookmarkMap.has(bookmarkId)) {
        bookmarkMap.set(bookmarkId, []);
      }
      bookmarkMap.get(bookmarkId)!.push({ qa: result.item, score: result.score });
    }

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Grouped results by bookmark', {
        uniqueBookmarks: bookmarkMap.size,
        totalMatches: [...bookmarkMap.values()].reduce((sum, arr) => sum + arr.length, 0),
      });
    }

    if (bookmarkMap.size === 0) {
      if (__DEBUG_EMBEDDINGS__) {
        console.log('[Search] No results found');
      }
      searchResults.innerHTML = '<div class="empty-state">No results found</div>';
      searchCount.textContent = '0';
      return;
    }

    // Build sorted results array for pagination
    // Sort by best score per bookmark
    const sortedEntries = [...bookmarkMap.entries()].sort((a, b) => {
      const maxScoreA = Math.max(...a[1].map(r => r.score));
      const maxScoreB = Math.max(...b[1].map(r => r.score));
      return maxScoreB - maxScoreA;
    });

    // Fetch bookmark data and build results array
    for (const [bookmarkId, qaResults] of sortedEntries) {
      const bookmark = await db.bookmarks.get(bookmarkId);
      if (!bookmark) continue;

      currentSearchResults.push({
        bookmarkId,
        bookmark,
        qaResults,
      });
    }

    searchCount.textContent = currentSearchResults.length.toString();

    // Render initial results
    renderSearchResults();

    if (__DEBUG_EMBEDDINGS__) {
      console.log('[Search] Search completed successfully', {
        totalResults: currentSearchResults.length,
        displayedResults: displayedResultsCount,
      });
    }

    switchView('search');
  } catch (error) {
    console.error('[Search] Error performing search:', error);
    searchResults.innerHTML = `<div class="error-message">Search failed: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// Render search results with pagination
function renderSearchResults() {
  const startIndex = displayedResultsCount;
  const endIndex = Math.min(startIndex + RESULTS_PER_PAGE, currentSearchResults.length);

  // If this is the first render, clear the container
  if (startIndex === 0) {
    searchResults.innerHTML = '';
  } else {
    // Remove existing "Load more" button if present
    const existingLoadMore = searchResults.querySelector('.load-more-container');
    if (existingLoadMore) {
      existingLoadMore.remove();
    }
  }

  // Add result cards
  for (let i = startIndex; i < endIndex; i++) {
    const result = currentSearchResults[i];
    const card = createSearchResultCard(result.bookmark, result.qaResults);
    searchResults.appendChild(card);
  }

  displayedResultsCount = endIndex;

  // Add "Load more" button if there are more results
  if (displayedResultsCount < currentSearchResults.length) {
    const remaining = currentSearchResults.length - displayedResultsCount;
    const loadMoreContainer = document.createElement('div');
    loadMoreContainer.className = 'load-more-container';
    loadMoreContainer.innerHTML = `
      <button class="btn btn-secondary load-more-btn">
        Load more (${remaining} remaining)
      </button>
    `;

    const loadMoreBtn = loadMoreContainer.querySelector('.load-more-btn') as HTMLButtonElement;
    loadMoreBtn.addEventListener('click', () => {
      renderSearchResults();
    });

    searchResults.appendChild(loadMoreContainer);
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
exportBtn.addEventListener('click', exportCurrentBookmark);
exportAllBtn.addEventListener('click', handleExportAll);
debugHtmlBtn.addEventListener('click', debugCurrentBookmarkHtml);
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

// Expose test helpers for e2e tests
declare global {
  interface Window {
    __testHelpers?: {
      getBookmarkStatus: () => Promise<any>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__testHelpers = {
    async getBookmarkStatus() {
      const bookmarks = await db.bookmarks.toArray();
      const markdown = await db.markdown.toArray();

      return {
        bookmarks: bookmarks.map(b => ({
          id: b.id,
          title: b.title,
          status: b.status,
          errorMessage: b.errorMessage,
          url: b.url,
        })),
        markdown: markdown.map(m => ({
          bookmarkId: m.bookmarkId,
          contentLength: m.content.length,
          contentPreview: m.content.slice(0, 200),
        })),
        markdownCount: markdown.length,
      };
    },
  };
}
