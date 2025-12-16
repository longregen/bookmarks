/**
 * Web Modality - Standalone webpage version of Bookmarks by Localforge
 *
 * This version runs entirely in the browser without requiring an extension.
 * It uses CORS proxies to fetch webpages and stores data in IndexedDB.
 */

import { db, Bookmark, Markdown, QuestionAnswer } from '../db/schema';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { cosineSimilarity, findTopK } from '../lib/similarity';
import { exportAllBookmarks, downloadExport, readImportFile, importBookmarks, validateImportData } from '../lib/export';
import { marked } from 'marked';

// ============================================================================
// Settings (localStorage-based for web)
// ============================================================================

interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
}

const SETTINGS_KEY = 'bookmark-rag-settings';
const THEME_KEY = 'bookmark-rag-theme';

const DEFAULT_SETTINGS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
};

function getSettings(): ApiSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Partial<ApiSettings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

// ============================================================================
// Theme (localStorage-based for web)
// ============================================================================

type Theme = 'auto' | 'light' | 'dark' | 'terminal' | 'tufte';

function getTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || 'auto';
}

function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  if (theme !== 'auto') {
    root.setAttribute('data-theme', theme);
  }
}

// ============================================================================
// CORS Proxy Fetch
// ============================================================================

// List of CORS proxies to try (in order)
const CORS_PROXIES = [
  { name: 'corsproxy.io', format: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
  { name: 'allorigins', format: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
];

interface FetchResult {
  html: string;
  finalUrl: string;
  proxyUsed: string;
}

async function fetchWithCorsProxy(url: string): Promise<FetchResult> {
  // First try direct fetch (might work for CORS-enabled sites)
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (response.ok) {
      const html = await response.text();
      return { html, finalUrl: response.url || url, proxyUsed: 'direct' };
    }
  } catch (e) {
    console.log('Direct fetch failed, trying proxies...');
  }

  // Try CORS proxies
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy.format(url);
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const html = await response.text();
        return { html, finalUrl: url, proxyUsed: proxy.name };
      }
    } catch (e) {
      console.log(`Proxy ${proxy.name} failed:`, e);
    }
  }

  throw new Error('All fetch methods failed. Try pasting the HTML directly.');
}

// ============================================================================
// Markdown Extraction
// ============================================================================

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string | null;
}

function extractMarkdown(html: string, url: string): ExtractedContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set base URL for relative links
  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);

  // Run Readability
  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    throw new Error('Could not extract readable content from page');
  }

  // Convert to markdown
  const contentDoc = parser.parseFromString(article.content ?? '', 'text/html');
  const markdown = turndown.turndown(contentDoc.body);

  return {
    title: article.title ?? '',
    content: markdown,
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
  };
}

// ============================================================================
// API Functions
// ============================================================================

const QA_SYSTEM_PROMPT = `You are a helpful assistant that generates question-answer pairs for semantic search retrieval.

Given a document, generate 5-10 diverse Q&A pairs that:
1. Cover the main topics and key facts in the document
2. Include both factual questions ("What is X?") and conceptual questions ("How does X work?")
3. Would help someone find this document when searching with related queries
4. Have concise but complete answers (1-3 sentences each)

Respond with JSON only, no other text. Format:
{"pairs": [{"question": "...", "answer": "..."}, ...]}`;

interface QAPair {
  question: string;
  answer: string;
}

async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = getSettings();

  if (!settings.apiKey) {
    throw new Error('API key not configured. Please set your API key in Settings.');
  }

  const truncatedContent = markdownContent.slice(0, 15000);

  const response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.chatModel,
      messages: [
        { role: 'system', content: QA_SYSTEM_PROMPT },
        { role: 'user', content: truncatedContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from chat API');
  }

  const parsed = JSON.parse(content);
  return parsed.pairs || [];
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = getSettings();

  if (!settings.apiKey) {
    throw new Error('API key not configured.');
  }

  const response = await fetch(`${settings.apiBaseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.embeddingModel,
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embeddings API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
  return sorted.map((item: any) => item.embedding);
}

// ============================================================================
// Processing Pipeline
// ============================================================================

async function processBookmark(bookmarkId: string, updateUI: (status: string) => void): Promise<void> {
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) throw new Error('Bookmark not found');

  try {
    await db.bookmarks.update(bookmarkId, { status: 'processing', updatedAt: new Date() });
    updateUI('Extracting content...');

    // Step 1: Extract markdown
    const extracted = extractMarkdown(bookmark.html, bookmark.url);

    await db.markdown.add({
      id: crypto.randomUUID(),
      bookmarkId,
      content: extracted.content,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Update title if extraction found a better one
    if (extracted.title && extracted.title !== bookmark.title) {
      await db.bookmarks.update(bookmarkId, { title: extracted.title, updatedAt: new Date() });
    }

    updateUI('Generating Q&A pairs...');

    // Step 2: Generate Q&A pairs
    const qaPairs = await generateQAPairs(extracted.content);

    if (qaPairs.length === 0) {
      throw new Error('No Q&A pairs generated');
    }

    updateUI('Creating embeddings...');

    // Step 3: Generate embeddings
    const textsToEmbed = qaPairs.flatMap(qa => [
      qa.question,
      qa.answer,
      `Q: ${qa.question}\nA: ${qa.answer}`,
    ]);

    const embeddings = await generateEmbeddings(textsToEmbed);

    // Step 4: Store Q&A pairs with embeddings
    for (let i = 0; i < qaPairs.length; i++) {
      const qa = qaPairs[i];
      const baseIdx = i * 3;

      await db.questionsAnswers.add({
        id: crypto.randomUUID(),
        bookmarkId,
        question: qa.question,
        answer: qa.answer,
        embeddingQuestion: embeddings[baseIdx],
        embeddingAnswer: embeddings[baseIdx + 1],
        embeddingBoth: embeddings[baseIdx + 2],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await db.bookmarks.update(bookmarkId, { status: 'complete', updatedAt: new Date() });
    updateUI('Complete!');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await db.bookmarks.update(bookmarkId, {
      status: 'error',
      errorMessage,
      updatedAt: new Date(),
    });
    throw error;
  }
}

// ============================================================================
// Search
// ============================================================================

interface SearchResult {
  bookmark: Bookmark;
  qa: QuestionAnswer;
  score: number;
}

async function searchBookmarks(query: string): Promise<SearchResult[]> {
  // Generate embedding for query
  const [queryEmbedding] = await generateEmbeddings([query]);

  // Get all Q&A pairs
  const allQA = await db.questionsAnswers.toArray();

  if (allQA.length === 0) {
    return [];
  }

  // Find top matches using combined embedding
  const items = allQA.map(qa => ({
    item: qa,
    embedding: qa.embeddingBoth,
  }));

  const topResults = findTopK(queryEmbedding, items, 20);

  // Get bookmark details for each result
  const results: SearchResult[] = [];
  const seenBookmarks = new Set<string>();

  for (const { item: qa, score } of topResults) {
    // Only show best result per bookmark
    if (seenBookmarks.has(qa.bookmarkId)) continue;
    seenBookmarks.add(qa.bookmarkId);

    const bookmark = await db.bookmarks.get(qa.bookmarkId);
    if (bookmark) {
      results.push({ bookmark, qa, score });
    }
  }

  return results.slice(0, 10);
}

// ============================================================================
// UI State & Elements
// ============================================================================

interface UIState {
  currentView: 'add' | 'explore' | 'settings';
  currentSubview: 'list' | 'search';
  selectedBookmarkId: string | null;
  fetchedHtml: string | null;
  fetchedUrl: string | null;
}

const state: UIState = {
  currentView: 'add',
  currentSubview: 'list',
  selectedBookmarkId: null,
  fetchedHtml: null,
  fetchedUrl: null,
};

// Element references
const elements = {
  // Navigation
  navAdd: document.getElementById('navAdd')!,
  navExplore: document.getElementById('navExplore')!,
  navSettings: document.getElementById('navSettings')!,

  // Views
  addView: document.getElementById('addView')!,
  exploreView: document.getElementById('exploreView')!,
  settingsView: document.getElementById('settingsView')!,

  // Add View
  urlInput: document.getElementById('urlInput') as HTMLInputElement,
  fetchBtn: document.getElementById('fetchBtn')!,
  htmlInput: document.getElementById('htmlInput') as HTMLTextAreaElement,
  titleInput: document.getElementById('titleInput') as HTMLInputElement,
  saveBtn: document.getElementById('saveBtn')!,
  previewBtn: document.getElementById('previewBtn')!,
  addStatus: document.getElementById('addStatus')!,
  previewPanel: document.getElementById('previewPanel')!,
  previewFrame: document.getElementById('previewFrame') as HTMLIFrameElement,
  closePreviewBtn: document.getElementById('closePreviewBtn')!,

  // Explore View
  searchInput: document.getElementById('searchInput') as HTMLInputElement,
  searchBtn: document.getElementById('searchBtn')!,
  listViewBtn: document.getElementById('listViewBtn')!,
  searchViewBtn: document.getElementById('searchViewBtn')!,
  listSubview: document.getElementById('listSubview')!,
  searchSubview: document.getElementById('searchSubview')!,
  bookmarkList: document.getElementById('bookmarkList')!,
  bookmarkCount: document.getElementById('bookmarkCount')!,
  searchResults: document.getElementById('searchResults')!,
  searchCount: document.getElementById('searchCount')!,

  // Settings View
  apiBaseUrl: document.getElementById('apiBaseUrl') as HTMLInputElement,
  apiKey: document.getElementById('apiKey') as HTMLInputElement,
  chatModel: document.getElementById('chatModel') as HTMLInputElement,
  embeddingModel: document.getElementById('embeddingModel') as HTMLInputElement,
  saveSettingsBtn: document.getElementById('saveSettingsBtn')!,
  settingsStatus: document.getElementById('settingsStatus')!,
  exportBtn: document.getElementById('exportBtn')!,
  importFile: document.getElementById('importFile') as HTMLInputElement,
  clearDataBtn: document.getElementById('clearDataBtn')!,

  // Detail View
  detailView: document.getElementById('detailView')!,
  detailBackdrop: document.getElementById('detailBackdrop')!,
  closeDetailBtn: document.getElementById('closeDetailBtn')!,
  processBtn: document.getElementById('processBtn')!,
  deleteBtn: document.getElementById('deleteBtn')!,
  detailContent: document.getElementById('detailContent')!,
};

// ============================================================================
// UI Functions
// ============================================================================

function showView(view: 'add' | 'explore' | 'settings'): void {
  state.currentView = view;

  // Update nav
  elements.navAdd.classList.toggle('active', view === 'add');
  elements.navExplore.classList.toggle('active', view === 'explore');
  elements.navSettings.classList.toggle('active', view === 'settings');

  // Update views
  elements.addView.classList.toggle('active', view === 'add');
  elements.exploreView.classList.toggle('active', view === 'explore');
  elements.settingsView.classList.toggle('active', view === 'settings');

  // Refresh data when switching to explore
  if (view === 'explore') {
    loadBookmarkList();
  }
}

function showSubview(subview: 'list' | 'search'): void {
  state.currentSubview = subview;

  elements.listViewBtn.classList.toggle('active', subview === 'list');
  elements.searchViewBtn.classList.toggle('active', subview === 'search');
  elements.listSubview.classList.toggle('active', subview === 'list');
  elements.searchSubview.classList.toggle('active', subview === 'search');
}

function showStatus(element: HTMLElement, message: string, type: 'success' | 'error' | 'info' | 'loading'): void {
  element.textContent = message;
  element.className = `status-message ${type}`;
  element.classList.remove('hidden');
}

function hideStatus(element: HTMLElement): void {
  element.classList.add('hidden');
}

function updateAddButtonState(): void {
  const hasContent = state.fetchedHtml || elements.htmlInput.value.trim();
  const hasUrl = state.fetchedUrl || elements.urlInput.value.trim();
  elements.saveBtn.disabled = !hasContent || !hasUrl;
  elements.previewBtn.disabled = !hasContent;
}

async function loadBookmarkList(): Promise<void> {
  const bookmarks = await db.bookmarks.orderBy('createdAt').reverse().toArray();
  elements.bookmarkCount.textContent = String(bookmarks.length);

  if (bookmarks.length === 0) {
    elements.bookmarkList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">[ ]</div>
        <div class="empty-state__title">No bookmarks yet</div>
        <div class="empty-state__description">
          Add your first bookmark using the Add tab above.
        </div>
      </div>
    `;
    return;
  }

  elements.bookmarkList.innerHTML = bookmarks.map(b => `
    <div class="bookmark-card" data-id="${b.id}">
      <div class="bookmark-header">
        <div>
          <div class="bookmark-title">${escapeHtml(b.title)}</div>
          <a href="${escapeHtml(b.url)}" class="bookmark-url" target="_blank" onclick="event.stopPropagation()">
            ${escapeHtml(truncateUrl(b.url))}
          </a>
        </div>
        <span class="status-badge status-${b.status}">${b.status}</span>
      </div>
      <div class="bookmark-meta">
        <span>${formatDate(b.createdAt)}</span>
      </div>
    </div>
  `).join('');

  // Add click handlers
  elements.bookmarkList.querySelectorAll('.bookmark-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      if (id) openBookmarkDetail(id);
    });
  });
}

async function openBookmarkDetail(bookmarkId: string): Promise<void> {
  state.selectedBookmarkId = bookmarkId;

  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) return;

  const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

  // Build content
  let html = `
    <h2>${escapeHtml(bookmark.title)}</h2>
    <p><a href="${escapeHtml(bookmark.url)}" target="_blank">${escapeHtml(bookmark.url)}</a></p>
    <p class="bookmark-meta">
      <span class="status-badge status-${bookmark.status}">${bookmark.status}</span>
      <span>Added ${formatDate(bookmark.createdAt)}</span>
    </p>
  `;

  if (bookmark.errorMessage) {
    html += `<div class="error-message">${escapeHtml(bookmark.errorMessage)}</div>`;
  }

  if (markdown) {
    html += `
      <div class="markdown-content">
        ${marked.parse(markdown.content)}
      </div>
    `;
  }

  if (qaPairs.length > 0) {
    html += `
      <div class="qa-section">
        <h3>Generated Q&A (${qaPairs.length} pairs)</h3>
        ${qaPairs.map(qa => `
          <div class="qa-pair">
            <div class="qa-question">Q: ${escapeHtml(qa.question)}</div>
            <div class="qa-answer">A: ${escapeHtml(qa.answer)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  elements.detailContent.innerHTML = html;

  // Show/hide process button based on status
  elements.processBtn.classList.toggle('hidden', bookmark.status === 'complete' || bookmark.status === 'processing');

  // Show panel
  elements.detailView.classList.add('active');
  elements.detailBackdrop.classList.add('active');
}

function closeBookmarkDetail(): void {
  state.selectedBookmarkId = null;
  elements.detailView.classList.remove('active');
  elements.detailBackdrop.classList.remove('active');
}

async function displaySearchResults(results: SearchResult[]): Promise<void> {
  elements.searchCount.textContent = String(results.length);

  if (results.length === 0) {
    elements.searchResults.innerHTML = `
      <div class="empty-state">
        No matching bookmarks found
      </div>
    `;
    return;
  }

  elements.searchResults.innerHTML = results.map(r => `
    <div class="search-result-card" data-id="${r.bookmark.id}">
      <span class="similarity-score">${(r.score * 100).toFixed(1)}% match</span>
      <div class="bookmark-title">${escapeHtml(r.bookmark.title)}</div>
      <a href="${escapeHtml(r.bookmark.url)}" class="bookmark-url" target="_blank" onclick="event.stopPropagation()">
        ${escapeHtml(truncateUrl(r.bookmark.url))}
      </a>
      <div class="qa-pair">
        <div class="qa-question">Q: ${escapeHtml(r.qa.question)}</div>
        <div class="qa-answer">A: ${escapeHtml(r.qa.answer)}</div>
      </div>
    </div>
  `).join('');

  // Add click handlers
  elements.searchResults.querySelectorAll('.search-result-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      if (id) openBookmarkDetail(id);
    });
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength - 3) + '...';
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 365) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers(): void {
  // Navigation
  elements.navAdd.addEventListener('click', (e) => { e.preventDefault(); showView('add'); });
  elements.navExplore.addEventListener('click', (e) => { e.preventDefault(); showView('explore'); });
  elements.navSettings.addEventListener('click', (e) => { e.preventDefault(); showView('settings'); });

  // Add View - Fetch URL
  elements.fetchBtn.addEventListener('click', async () => {
    const url = elements.urlInput.value.trim();
    if (!url) {
      showStatus(elements.addStatus, 'Please enter a URL', 'error');
      return;
    }

    try {
      showStatus(elements.addStatus, 'Fetching page...', 'loading');
      elements.fetchBtn.disabled = true;

      const result = await fetchWithCorsProxy(url);
      state.fetchedHtml = result.html;
      state.fetchedUrl = result.finalUrl;

      showStatus(elements.addStatus, `Fetched via ${result.proxyUsed}. Ready to save!`, 'success');
      updateAddButtonState();

    } catch (error) {
      showStatus(elements.addStatus, error instanceof Error ? error.message : 'Fetch failed', 'error');
    } finally {
      elements.fetchBtn.disabled = false;
    }
  });

  // Add View - HTML input change
  elements.htmlInput.addEventListener('input', () => {
    state.fetchedHtml = null; // Clear fetched state when manually editing
    updateAddButtonState();
  });

  elements.urlInput.addEventListener('input', () => {
    state.fetchedUrl = null;
    state.fetchedHtml = null;
    updateAddButtonState();
  });

  // Add View - Preview
  elements.previewBtn.addEventListener('click', () => {
    const html = state.fetchedHtml || elements.htmlInput.value.trim();
    if (html) {
      elements.previewFrame.srcdoc = html;
      elements.previewPanel.classList.remove('hidden');
    }
  });

  elements.closePreviewBtn.addEventListener('click', () => {
    elements.previewPanel.classList.add('hidden');
  });

  // Add View - Save Bookmark
  elements.saveBtn.addEventListener('click', async () => {
    const html = state.fetchedHtml || elements.htmlInput.value.trim();
    const url = state.fetchedUrl || elements.urlInput.value.trim();
    const customTitle = elements.titleInput.value.trim();

    if (!html || !url) {
      showStatus(elements.addStatus, 'Missing URL or HTML content', 'error');
      return;
    }

    try {
      showStatus(elements.addStatus, 'Saving bookmark...', 'loading');
      elements.saveBtn.disabled = true;

      // Extract title from HTML if not provided
      let title = customTitle;
      if (!title) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        title = doc.title || new URL(url).hostname;
      }

      // Check for duplicate
      const existing = await db.bookmarks.where('url').equals(url).first();
      if (existing) {
        showStatus(elements.addStatus, 'This URL is already bookmarked', 'error');
        elements.saveBtn.disabled = false;
        return;
      }

      // Create bookmark
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        url,
        title,
        html,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.bookmarks.add(bookmark);

      showStatus(elements.addStatus, 'Bookmark saved! Go to Explore to process it.', 'success');

      // Clear form
      elements.urlInput.value = '';
      elements.htmlInput.value = '';
      elements.titleInput.value = '';
      state.fetchedHtml = null;
      state.fetchedUrl = null;
      updateAddButtonState();

    } catch (error) {
      showStatus(elements.addStatus, error instanceof Error ? error.message : 'Save failed', 'error');
    } finally {
      elements.saveBtn.disabled = false;
    }
  });

  // Explore View - Toggle
  elements.listViewBtn.addEventListener('click', () => showSubview('list'));
  elements.searchViewBtn.addEventListener('click', () => showSubview('search'));

  // Explore View - Search
  const doSearch = async () => {
    const query = elements.searchInput.value.trim();
    if (!query) {
      showStatus(elements.searchResults as any, 'Please enter a search query', 'info');
      return;
    }

    const settings = getSettings();
    if (!settings.apiKey) {
      elements.searchResults.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">API Key Required</div>
          <div class="empty-state__description">
            Configure your API key in Settings to enable semantic search.
          </div>
        </div>
      `;
      return;
    }

    try {
      elements.searchResults.innerHTML = '<div class="loading">Searching...</div>';
      showSubview('search');

      const results = await searchBookmarks(query);
      displaySearchResults(results);

    } catch (error) {
      elements.searchResults.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__title">Search Error</div>
          <div class="empty-state__description">${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</div>
        </div>
      `;
    }
  };

  elements.searchBtn.addEventListener('click', doSearch);
  elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Detail View
  elements.closeDetailBtn.addEventListener('click', closeBookmarkDetail);
  elements.detailBackdrop.addEventListener('click', closeBookmarkDetail);

  elements.processBtn.addEventListener('click', async () => {
    if (!state.selectedBookmarkId) return;

    const settings = getSettings();
    if (!settings.apiKey) {
      alert('Please configure your API key in Settings first.');
      return;
    }

    try {
      elements.processBtn.disabled = true;
      elements.processBtn.textContent = 'Processing...';

      await processBookmark(state.selectedBookmarkId, (status) => {
        elements.processBtn.textContent = status;
      });

      // Refresh detail view
      await openBookmarkDetail(state.selectedBookmarkId);
      loadBookmarkList();

    } catch (error) {
      alert(error instanceof Error ? error.message : 'Processing failed');
      // Refresh to show error state
      await openBookmarkDetail(state.selectedBookmarkId);
    } finally {
      elements.processBtn.disabled = false;
      elements.processBtn.textContent = 'Process';
    }
  });

  elements.deleteBtn.addEventListener('click', async () => {
    if (!state.selectedBookmarkId) return;

    if (!confirm('Are you sure you want to delete this bookmark?')) return;

    try {
      // Delete related data
      await db.questionsAnswers.where('bookmarkId').equals(state.selectedBookmarkId).delete();
      await db.markdown.where('bookmarkId').equals(state.selectedBookmarkId).delete();
      await db.bookmarks.delete(state.selectedBookmarkId);

      closeBookmarkDetail();
      loadBookmarkList();

    } catch (error) {
      alert(error instanceof Error ? error.message : 'Delete failed');
    }
  });

  // Settings
  elements.saveSettingsBtn.addEventListener('click', () => {
    saveSettings({
      apiBaseUrl: elements.apiBaseUrl.value.trim() || DEFAULT_SETTINGS.apiBaseUrl,
      apiKey: elements.apiKey.value.trim(),
      chatModel: elements.chatModel.value.trim() || DEFAULT_SETTINGS.chatModel,
      embeddingModel: elements.embeddingModel.value.trim() || DEFAULT_SETTINGS.embeddingModel,
    });
    showStatus(elements.settingsStatus, 'Settings saved!', 'success');
    setTimeout(() => hideStatus(elements.settingsStatus), 3000);
  });

  elements.exportBtn.addEventListener('click', async () => {
    try {
      const data = await exportAllBookmarks();
      downloadExport(data);
      showStatus(elements.settingsStatus, `Exported ${data.bookmarkCount} bookmarks`, 'success');
    } catch (error) {
      showStatus(elements.settingsStatus, error instanceof Error ? error.message : 'Export failed', 'error');
    }
  });

  elements.importFile.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      showStatus(elements.settingsStatus, 'Importing...', 'loading');
      const data = await readImportFile(file);
      const result = await importBookmarks(data, file.name);
      showStatus(
        elements.settingsStatus,
        `Imported ${result.imported} bookmarks, skipped ${result.skipped} duplicates`,
        result.success ? 'success' : 'error'
      );
      loadBookmarkList();
    } catch (error) {
      showStatus(elements.settingsStatus, error instanceof Error ? error.message : 'Import failed', 'error');
    }

    // Reset file input
    elements.importFile.value = '';
  });

  elements.clearDataBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL bookmarks? This cannot be undone.')) return;
    if (!confirm('Really delete everything?')) return;

    try {
      await db.questionsAnswers.clear();
      await db.markdown.clear();
      await db.bookmarks.clear();
      await db.jobs.clear();

      showStatus(elements.settingsStatus, 'All data cleared', 'success');
      loadBookmarkList();
    } catch (error) {
      showStatus(elements.settingsStatus, error instanceof Error ? error.message : 'Clear failed', 'error');
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================

function loadSettingsToForm(): void {
  const settings = getSettings();
  elements.apiBaseUrl.value = settings.apiBaseUrl;
  elements.apiKey.value = settings.apiKey;
  elements.chatModel.value = settings.chatModel;
  elements.embeddingModel.value = settings.embeddingModel;
}

async function init(): Promise<void> {
  // Apply theme
  applyTheme(getTheme());

  // Load settings into form
  loadSettingsToForm();

  // Setup event handlers
  setupEventHandlers();

  // Initial UI state
  updateAddButtonState();

  // Load bookmarks if we start on explore
  if (state.currentView === 'explore') {
    await loadBookmarkList();
  }

  console.log('Bookmarks Web Demo initialized');
}

// Start the app
init().catch(console.error);
