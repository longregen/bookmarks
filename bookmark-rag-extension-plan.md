# Bookmark RAG Browser Extension — Implementation Plan

## Overview

A browser extension for Chrome and Firefox that captures web pages as bookmarks, extracts readable content, and enables semantic search across the user's bookmark collection using RAG (Retrieval-Augmented Generation).

### Core Features

1. **One-click bookmark capture** — saves URL, title, and full DOM HTML
2. **Automatic content extraction** — converts HTML to Markdown using Mozilla's Readability
3. **Q&A generation** — LLM generates question-answer pairs for each bookmark
4. **Embedding-based search** — user can semantically search their bookmarks
5. **Configurable API** — user provides their own OpenAI-compatible endpoint

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Extension                         │
├──────────────┬──────────────────────┬───────────────────────────┤
│   Popup UI   │    Content Script    │      Service Worker       │
│  (quick add) │   (DOM extraction)   │    (background processing)│
├──────────────┴──────────────────────┴───────────────────────────┤
│                          IndexedDB                               │
│       bookmarks | markdown | questions_and_answers | settings    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                   OpenAI-compatible API
              (chat completions + embeddings)
```

---

## Data Schema (IndexedDB)

Use [Dexie.js](https://dexie.org/) for IndexedDB access. All tables include `createdAt` and `updatedAt` timestamps.

### Tables

```typescript
// src/db/schema.ts

import Dexie, { Table } from 'dexie';

export interface Bookmark {
  id: string;                  // crypto.randomUUID()
  url: string;
  title: string;
  html: string;                // full document.documentElement.outerHTML
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Markdown {
  id: string;                  // crypto.randomUUID()
  bookmarkId: string;          // foreign key → Bookmark.id
  content: string;             // Readability output converted to Markdown
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionAnswer {
  id: string;                  // crypto.randomUUID()
  bookmarkId: string;          // foreign key → Bookmark.id
  question: string;
  answer: string;
  embeddingQuestion: number[]; // Float array, 1536 dims for text-embedding-3-small
  embeddingAnswer: number[];
  embeddingBoth: number[];     // embedding of "Q: {question}\nA: {answer}"
  createdAt: Date;
  updatedAt: Date;
}

export interface Settings {
  key: string;                 // primary key, e.g., 'api'
  value: any;                  // JSON-serializable value
  createdAt: Date;
  updatedAt: Date;
}

export class BookmarkDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  markdown!: Table<Markdown>;
  questionsAnswers!: Table<QuestionAnswer>;
  settings!: Table<Settings>;

  constructor() {
    super('BookmarkRAG');
    
    this.version(1).stores({
      bookmarks: 'id, url, status, createdAt, updatedAt',
      markdown: 'id, bookmarkId, createdAt, updatedAt',
      questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
      settings: 'key, createdAt, updatedAt',
    });
  }
}

export const db = new BookmarkDatabase();
```

### Settings Structure

The `settings` table stores configuration as key-value pairs:

| Key | Value Type | Default |
|-----|------------|---------|
| `apiBaseUrl` | string | `https://api.openai.com/v1` |
| `apiKey` | string | `""` (empty, must be configured) |
| `chatModel` | string | `gpt-4o-mini` |
| `embeddingModel` | string | `text-embedding-3-small` |

---

## User Flows

### Flow 1: Adding a Bookmark

**Goal**: Frictionless, < 200ms perceived latency.

**Trigger**: User clicks extension icon or presses keyboard shortcut (e.g., `Ctrl+Shift+B`).

```
┌─────────────────┐
│  User triggers  │
│   bookmark add  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Content Script executes:           │
│  - url = location.href              │
│  - title = document.title           │
│  - html = document.documentElement  │
│          .outerHTML                 │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  chrome.runtime.sendMessage()       │
│  sends {url, title, html} to        │
│  service worker                     │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Service Worker:                    │
│  - Generate UUID                    │
│  - Insert into IndexedDB            │
│    (status: 'pending')              │
│  - Add to processing queue          │
│  - Respond with { success: true }   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Popup shows "✓ Saved" toast        │
│  Auto-dismisses after 1.5s          │
└─────────────────────────────────────┘
```

**Key implementation notes**:

- Capture `outerHTML`, not fetched HTML, to preserve JavaScript-rendered content
- Do not wait for any processing; return immediately after IndexedDB write
- The popup should be minimal: just a confirmation toast, no form fields

### Flow 2: Background Processing

**Goal**: Process pending bookmarks sequentially without blocking the UI.

The service worker maintains a processing queue. When a new bookmark is added or the extension starts, it processes all pending bookmarks one at a time.

```
┌─────────────────────────────────────────────────────────────────┐
│  PROCESSING PIPELINE (for each pending bookmark)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. UPDATE STATUS                                               │
│     - Set bookmark.status = 'processing'                        │
│     - Set bookmark.updatedAt = new Date()                       │
│                                                                 │
│  2. MARKDOWN EXTRACTION                                         │
│     - Parse HTML with DOMParser                                 │
│     - Run @mozilla/readability to extract article content       │
│     - Convert Readability output to Markdown with Turndown      │
│     - Insert into 'markdown' table                              │
│                                                                 │
│  3. Q&A GENERATION                                              │
│     - Send markdown to chat completions endpoint                │
│     - Parse JSON response containing Q&A pairs                  │
│     - Typically generates 5-10 pairs per bookmark               │
│                                                                 │
│  4. EMBEDDING GENERATION                                        │
│     - For each Q&A pair, generate 3 embeddings:                 │
│       • embeddingQuestion (question only)                       │
│       • embeddingAnswer (answer only)                           │
│       • embeddingBoth ("Q: {q}\nA: {a}")                        │
│     - Batch embedding requests where possible                   │
│     - Insert Q&A records into 'questionsAnswers' table          │
│                                                                 │
│  5. MARK COMPLETE                                               │
│     - Set bookmark.status = 'complete'                          │
│     - Set bookmark.updatedAt = new Date()                       │
│                                                                 │
│  ON ERROR AT ANY STEP:                                          │
│     - Set bookmark.status = 'error'                             │
│     - Set bookmark.errorMessage = error.message                 │
│     - Set bookmark.updatedAt = new Date()                       │
│     - Continue to next bookmark in queue                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 3: Exploring & Searching

**Goal**: Allow users to browse bookmarks and semantically search their collection.

Opens as a full tab: `chrome.tabs.create({ url: chrome.runtime.getURL('explore.html') })`

```
┌─────────────────────────────────────────────────────────────────┐
│  EXPLORE VIEW                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  🔍  Search your bookmarks...                    [Search]  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Recent Bookmarks                                          │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  📄 How to build a browser extension          ● complete   │ │
│  │     example.com · 2 hours ago                              │ │
│  │                                                            │ │
│  │  📄 IndexedDB performance optimization        ● complete   │ │
│  │     developer.mozilla.org · 5 hours ago                    │ │
│  │                                                            │ │
│  │  📄 Understanding vector embeddings           ◐ processing │ │
│  │     blog.openai.com · 1 day ago                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Clicking a bookmark opens detail view:                         │
│  - Full markdown content                                        │
│  - List of generated Q&A pairs                                  │
│  - Link to original URL                                         │
│  - Option to delete bookmark                                    │
│  - Option to retry processing (if status = 'error')             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Semantic Search Flow**:

```
┌─────────────────┐
│  User enters    │
│  search query   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Call embeddings API                │
│  to embed the query                 │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Load all Q&A embeddings from       │
│  IndexedDB into memory              │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Compute cosine similarity between  │
│  query embedding and all stored     │
│  embeddings (embeddingQuestion,     │
│  embeddingBoth — pick best match)   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Sort by similarity score           │
│  Take top K results (K = 20)        │
│  Group by bookmark                  │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Display results:                   │
│  - Bookmark title + URL             │
│  - Matching Q&A pairs               │
│  - Similarity score (optional)      │
└─────────────────────────────────────┘
```

**Performance note**: For up to a few thousand Q&A entries, brute-force cosine similarity in JavaScript is fast enough (< 50ms). No vector database needed.

---

## API Integration

### Settings Helper

```typescript
// src/lib/settings.ts

import { db } from '../db/schema';

export interface ApiSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
}

const DEFAULTS: ApiSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
};

export async function getSettings(): Promise<ApiSettings> {
  const rows = await db.settings.toArray();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  
  return {
    apiBaseUrl: map.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    apiKey: map.apiKey ?? DEFAULTS.apiKey,
    chatModel: map.chatModel ?? DEFAULTS.chatModel,
    embeddingModel: map.embeddingModel ?? DEFAULTS.embeddingModel,
  };
}

export async function saveSetting(key: keyof ApiSettings, value: string): Promise<void> {
  const now = new Date();
  const existing = await db.settings.get(key);
  
  if (existing) {
    await db.settings.update(key, { value, updatedAt: now });
  } else {
    await db.settings.add({ key, value, createdAt: now, updatedAt: now });
  }
}
```

### Chat Completions (Q&A Generation)

```typescript
// src/lib/api.ts

import { getSettings } from './settings';

interface QAPair {
  question: string;
  answer: string;
}

const QA_SYSTEM_PROMPT = `You are a helpful assistant that generates question-answer pairs for semantic search retrieval.

Given a document, generate 5-10 diverse Q&A pairs that:
1. Cover the main topics and key facts in the document
2. Include both factual questions ("What is X?") and conceptual questions ("How does X work?")
3. Would help someone find this document when searching with related queries
4. Have concise but complete answers (1-3 sentences each)

Respond with JSON only, no other text. Format:
{"pairs": [{"question": "...", "answer": "..."}, ...]}`;

export async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getSettings();
  
  if (!settings.apiKey) {
    throw new Error('API key not configured. Please set your API key in the extension options.');
  }
  
  // Truncate content to avoid exceeding context window
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
```

### Embeddings

```typescript
// src/lib/api.ts (continued)

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getSettings();
  
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
  
  // Sort by index to ensure correct order
  const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
  return sorted.map((item: any) => item.embedding);
}
```

---

## Content Extraction

### Readability + Turndown

```typescript
// src/lib/extract.ts

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export interface ExtractedContent {
  title: string;
  content: string;      // Markdown
  excerpt: string;
  byline: string | null;
}

export function extractMarkdown(html: string, url: string): ExtractedContent {
  // Parse HTML into a DOM document
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Set the base URL for relative link resolution
  const base = doc.createElement('base');
  base.href = url;
  doc.head.insertBefore(base, doc.head.firstChild);
  
  // Run Readability
  const reader = new Readability(doc);
  const article = reader.parse();
  
  if (!article) {
    throw new Error('Readability could not parse the page');
  }
  
  // Convert HTML content to Markdown
  const markdown = turndown.turndown(article.content);
  
  return {
    title: article.title,
    content: markdown,
    excerpt: article.excerpt || '',
    byline: article.byline,
  };
}
```

---

## Similarity Search

```typescript
// src/lib/similarity.ts

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Find the top K most similar items.
 */
export function findTopK<T>(
  queryEmbedding: number[],
  items: Array<{ item: T; embedding: number[] }>,
  k: number
): Array<{ item: T; score: number }> {
  const scored = items.map(({ item, embedding }) => ({
    item,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, k);
}
```

---

## Project Structure

```
bookmark-rag-extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   ├── db/
│   │   └── schema.ts              # Dexie database definition
│   │
│   ├── lib/
│   │   ├── api.ts                 # OpenAI-compatible API client
│   │   ├── extract.ts             # Readability + Turndown
│   │   ├── settings.ts            # Settings CRUD
│   │   └── similarity.ts          # Cosine similarity utilities
│   │
│   ├── background/
│   │   ├── service-worker.ts      # Main entry point
│   │   ├── queue.ts               # Processing queue management
│   │   └── processor.ts           # Bookmark processing pipeline
│   │
│   ├── content/
│   │   └── capture.ts             # DOM capture content script
│   │
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   │
│   ├── explore/
│   │   ├── explore.html
│   │   ├── explore.ts
│   │   └── explore.css
│   │
│   └── options/
│       ├── options.html
│       ├── options.ts
│       └── options.css
│
└── public/
    └── icons/
        ├── icon-16.png
        ├── icon-48.png
        └── icon-128.png
```

---

## Manifest

```json
{
  "manifest_version": 3,
  "name": "Bookmark RAG",
  "version": "1.0.0",
  "description": "Capture and semantically search your bookmarks",
  
  "permissions": [
    "storage",
    "activeTab",
    "scripting"
  ],
  
  "host_permissions": [
    "<all_urls>"
  ],
  
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png"
    }
  },
  
  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  },
  
  "commands": {
    "save-bookmark": {
      "suggested_key": {
        "default": "Ctrl+Shift+B",
        "mac": "Command+Shift+B"
      },
      "description": "Save current page as bookmark"
    }
  },
  
  "icons": {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png"
  }
}
```

**Note**: The actual manifest will need adjustment based on your build tool. Vite with `@crxjs/vite-plugin` or similar will handle the TypeScript compilation.

---

## Implementation Phases

### Phase 1: Project Scaffolding
**Estimated effort: 1-2 days**

- Initialize project with Vite + TypeScript
- Configure build for browser extension (recommend `@crxjs/vite-plugin` or `vite-plugin-web-extension`)
- Set up Dexie.js with schema
- Create manifest.json
- Verify extension loads in both Chrome and Firefox

**Deliverables**:
- Empty extension that installs and shows popup
- Database initializes on extension load

### Phase 2: Bookmark Capture
**Estimated effort: 2-3 days**

- Implement content script for DOM capture
- Implement service worker message handling
- Implement popup UI with save confirmation
- Implement keyboard shortcut command
- Handle duplicate URL detection (optional: ask user or update existing)

**Deliverables**:
- User can save bookmarks via icon click or keyboard shortcut
- Bookmarks appear in IndexedDB with status 'pending'
- Popup shows success/failure feedback

### Phase 3: Options Page & API Configuration
**Estimated effort: 1-2 days**

- Build options page UI
- Implement settings persistence
- Add API key validation (test call to verify key works)
- Display helpful error messages for misconfiguration

**Deliverables**:
- User can configure API URL, key, and models
- Settings persist across browser restarts

### Phase 4: Background Processing
**Estimated effort: 3-4 days**

- Implement processing queue in service worker
- Implement Readability + Turndown extraction
- Implement Q&A generation API call
- Implement embedding generation API calls
- Implement error handling and retry logic
- Handle service worker lifecycle (may be terminated; queue must persist)

**Deliverables**:
- Pending bookmarks are automatically processed
- Markdown is extracted and stored
- Q&A pairs are generated and stored with embeddings
- Errors are captured and surfaced

### Phase 5: Explore View — Bookmark List
**Estimated effort: 2-3 days**

- Build explore page layout
- Display bookmark list with status indicators
- Implement bookmark detail view (markdown content, Q&A pairs)
- Implement delete bookmark functionality
- Implement retry processing for failed bookmarks

**Deliverables**:
- User can view all bookmarks
- User can see processing status
- User can view extracted content and Q&A pairs
- User can delete bookmarks

### Phase 6: Semantic Search
**Estimated effort: 2-3 days**

- Implement search input UI
- Implement query embedding via API
- Implement cosine similarity search across Q&A embeddings
- Display search results grouped by bookmark
- Link search results to bookmark detail view

**Deliverables**:
- User can search bookmarks semantically
- Results show relevant Q&A pairs with their source bookmarks

### Phase 7: Polish & Testing
**Estimated effort: 2-3 days**

- Test on Chrome and Firefox
- Handle edge cases (empty pages, very long pages, non-article pages)
- Add loading states throughout UI
- Improve error messages
- Add "no API key" onboarding flow
- Performance testing with hundreds of bookmarks

**Deliverables**:
- Stable extension working on both browsers
- Good UX for error states and loading states

---

## Total Estimated Effort

| Phase | Days |
|-------|------|
| 1. Scaffolding | 1-2 |
| 2. Bookmark Capture | 2-3 |
| 3. Options Page | 1-2 |
| 4. Background Processing | 3-4 |
| 5. Explore View | 2-3 |
| 6. Semantic Search | 2-3 |
| 7. Polish & Testing | 2-3 |
| **Total** | **13-20 days** |

---

## Dependencies

```json
{
  "dependencies": {
    "dexie": "^4.0.0",
    "@mozilla/readability": "^0.5.0",
    "turndown": "^7.1.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@crxjs/vite-plugin": "^2.0.0-beta.0",
    "@types/chrome": "^0.0.0"
  }
}
```

---

## Error Handling Guidelines

### API Errors

| Error | Handling |
|-------|----------|
| 401 Unauthorized | Surface "Invalid API key" message; link to options |
| 429 Rate Limited | Retry with exponential backoff (max 3 retries) |
| 500+ Server Error | Retry with exponential backoff (max 3 retries) |
| Network Error | Mark bookmark as 'error'; allow manual retry |

### Processing Errors

| Error | Handling |
|-------|----------|
| Readability fails | Store error message; skip to next bookmark |
| Empty Q&A response | Store 0 Q&A pairs; mark as complete (some pages have little content) |
| JSON parse error | Retry once; if fails again, mark as error |

### Service Worker Lifecycle

The service worker may be terminated by the browser at any time. To handle this:

1. Persist the processing queue in IndexedDB (use bookmark.status field)
2. On service worker startup, query for all 'pending' and 'processing' bookmarks
3. Reset 'processing' bookmarks back to 'pending' (they were interrupted)
4. Resume processing queue

---

## Testing Checklist

### Manual Testing

- [ ] Save bookmark via icon click
- [ ] Save bookmark via keyboard shortcut
- [ ] Bookmark appears with 'pending' status
- [ ] Processing completes and status changes to 'complete'
- [ ] Markdown content is readable
- [ ] Q&A pairs are generated
- [ ] Search returns relevant results
- [ ] Search with no results shows appropriate message
- [ ] Delete bookmark removes all associated data
- [ ] Retry failed bookmark works
- [ ] Extension works after browser restart
- [ ] Extension works in Firefox
- [ ] Extension works in Chrome

### Edge Cases

- [ ] Very long page (> 1MB HTML)
- [ ] Page with no article content (e.g., login page)
- [ ] Page with only images
- [ ] Non-English content
- [ ] API key not configured
- [ ] Invalid API key
- [ ] Network offline during processing
- [ ] Network offline during search
