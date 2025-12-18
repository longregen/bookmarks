# Message & Event Architecture Refactoring Plan

This document describes the refactoring of the extension's inter-component communication system to use a clear Command/Event separation pattern with consistent, descriptive naming.

## Goals

1. **Clear Command/Event Separation** - Commands are requests for action (imperative), Events are status reports (past tense)
2. **Consistent Naming Convention** - All messages follow `domain:action` pattern
3. **Unified Browser Rendering** - Replace HTTP fetch with tab-based DOM capture for accurate content extraction
4. **Self-Documenting Code** - Message names describe exactly what they do

---

## Part 1: Message Type Renaming

### Commands (Requests for Action)

| Current Name | New Name | Description |
|--------------|----------|-------------|
| `SAVE_BOOKMARK` | `bookmark:save_from_page` | Save bookmark with HTML payload from current page |
| `CAPTURE_PAGE` | `user_request:capture_current_tab` | User-initiated capture via keyboard shortcut |
| `START_PROCESSING` | `bookmark:retry` | Retry processing failed bookmarks (with trigger info in payload) |
| `START_BULK_IMPORT` | `import:create_from_url_list` | Start bulk import job from URL list |
| `FETCH_URL` | `browse:capture_dom_and_title` | Render page in browser tab and capture DOM |
| `EXTRACT_CONTENT` | `extract:markdown_from_html` | Extract markdown from HTML via Readability |
| `TRIGGER_SYNC` | `sync:trigger` | Manually trigger WebDAV sync |
| `UPDATE_SYNC_SETTINGS` | `sync:update_settings` | Update sync settings and reconfigure alarm |
| `GET_CURRENT_TAB_INFO` | `query:current_tab_info` | Query active tab URL and title |
| `GET_SYNC_STATUS` | `query:sync_status` | Query current sync status |
| `GET_PAGE_HTML` | `query:current_page_dom` | Query content script for page DOM |

### Events (Status Reports)

| Current Name | New Name | Description |
|--------------|----------|-------------|
| `BOOKMARK_UPDATED` | `bookmark:status_changed` | Bookmark processing status changed |
| `PROCESSING_COMPLETE` | `bookmark:ready` | Bookmark fully processed with embeddings |
| `TAG_UPDATED` | `tag:added` / `tag:removed` | Tag attached to or detached from bookmark |
| `JOB_UPDATED` | `job:progress_changed` | Job item completed or status changed |
| `SYNC_STATUS_UPDATED` | `sync:started` / `sync:completed` / `sync:failed` | Sync lifecycle events |

### New Events to Add

| Event Name | Description |
|------------|-------------|
| `bookmark:created` | New bookmark saved to database |
| `bookmark:content_fetched` | HTML content downloaded/captured |
| `bookmark:processing_started` | Processing queue picked up bookmark |
| `bookmark:processing_failed` | Processing failed after all retries |
| `bookmark:deleted` | Bookmark removed from database |
| `job:created` | Bulk import job started |
| `job:completed` | All job items finished |
| `job:failed` | Job completed with errors |

---

## Part 2: Unified Browser Rendering

### Current State

- **Chrome**: Uses offscreen document with `fetch()` - fast but misses JavaScript-rendered content
- **Firefox**: Uses tab rendering with `chrome.tabs.create()` - slower but captures full rendered DOM

### Target State

Both platforms use tab-based rendering for consistent, accurate content capture.

### Changes Required

#### 2.1 Remove Offscreen Fetch Capability

**Files to modify:**

- `src/offscreen/offscreen.ts`
  - Remove `FETCH_URL` message handler (lines 63-83)
  - Keep `EXTRACT_CONTENT` handler (renamed to `extract:markdown_from_html`)

- `src/lib/browser-fetch.ts`
  - Remove `fetchViaOffscreen()` function
  - Update `browserFetch()` to always use `renderPage()`

- `src/background/service-worker.ts`
  - Remove `FETCH_URL` from the pass-through comment (lines 146-151)
  - Update message type check

#### 2.2 Update Tab Renderer

**File:** `src/lib/tab-renderer.ts`

- Rename export to clarify purpose: `renderPage()` → `capturePageDom()`
- Update return type to include title: `Promise<{ html: string; title: string }>`
- Remove Firefox-specific conditional - use same approach for both platforms
- The `browse:capture_dom_and_title` command will be handled by this module

#### 2.3 Update Bulk Import Flow

**File:** `src/background/processor.ts`

- Update `fetchBookmarkHtml()` to use unified tab renderer
- Handle new return type with title

---

## Part 3: Type Definitions

### 3.1 New Message Types

**File:** `src/lib/messages.ts`

```typescript
// Commands - requests for action
export type Command =
  // User-initiated
  | { type: 'user_request:capture_current_tab' }

  // Bookmark operations
  | { type: 'bookmark:save_from_page'; data: { url: string; title: string; html: string } }
  | { type: 'bookmark:retry'; data: BookmarkRetryPayload }

  // Import operations
  | { type: 'import:create_from_url_list'; urls: string[] }

  // Browser operations (internal)
  | { type: 'browse:capture_dom_and_title'; url: string; timeoutMs?: number }
  | { type: 'extract:markdown_from_html'; html: string; url: string }

  // Sync operations
  | { type: 'sync:trigger' }
  | { type: 'sync:update_settings' }

  // Queries
  | { type: 'query:current_tab_info' }
  | { type: 'query:sync_status' }
  | { type: 'query:current_page_dom' };

// Retry payload with trigger information
export interface BookmarkRetryPayload {
  bookmarkId?: string;           // specific bookmark, or undefined for all failed
  trigger:
    | 'user_manual'              // clicked retry button in UI
    | 'auto_backoff'             // automatic retry after delay
    | 'settings_changed'         // API settings updated
    | 'queue_restart';           // general queue restart
  previousError?: string;
  attemptNumber?: number;
}
```

### 3.2 New Event Types

**File:** `src/lib/events.ts`

```typescript
export type EventType =
  // Bookmark lifecycle
  | 'bookmark:created'
  | 'bookmark:content_fetched'
  | 'bookmark:processing_started'
  | 'bookmark:status_changed'
  | 'bookmark:ready'
  | 'bookmark:processing_failed'
  | 'bookmark:deleted'

  // Tags
  | 'tag:added'
  | 'tag:removed'

  // Jobs
  | 'job:created'
  | 'job:progress_changed'
  | 'job:completed'
  | 'job:failed'

  // Sync
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed';

// Typed payloads for each event
export interface EventPayloads {
  'bookmark:created': { bookmarkId: string; url: string };
  'bookmark:content_fetched': { bookmarkId: string };
  'bookmark:processing_started': { bookmarkId: string };
  'bookmark:status_changed': { bookmarkId: string; oldStatus?: string; newStatus: string };
  'bookmark:ready': { bookmarkId: string };
  'bookmark:processing_failed': { bookmarkId: string; error: string };
  'bookmark:deleted': { bookmarkId: string };
  'tag:added': { bookmarkId: string; tagName: string };
  'tag:removed': { bookmarkId: string; tagName: string };
  'job:created': { jobId: string; totalItems: number };
  'job:progress_changed': { jobId: string; completedCount: number; totalCount: number };
  'job:completed': { jobId: string };
  'job:failed': { jobId: string; errorCount: number };
  'sync:started': { manual: boolean };
  'sync:completed': { action: 'uploaded' | 'downloaded' | 'no-change'; bookmarkCount?: number };
  'sync:failed': { error: string };
}
```

---

## Part 4: File-by-File Changes

### 4.1 Core Message Infrastructure

| File | Changes |
|------|---------|
| `src/lib/messages.ts` | Replace all type definitions with new Command types; update response type mappings |
| `src/lib/events.ts` | Replace EventType union; add EventPayloads interface; update broadcastEvent signature |

### 4.2 Background / Service Worker

| File | Changes |
|------|---------|
| `src/background/service-worker.ts` | Update all message type checks to new names; update command handler routing |
| `src/background/queue.ts` | Add event broadcasting for bookmark lifecycle; use new event names |
| `src/background/processor.ts` | Update to use unified tab renderer; broadcast `bookmark:content_fetched` |

### 4.3 Content Scripts

| File | Changes |
|------|---------|
| `src/content/capture.ts` | Update message types: `user_request:capture_current_tab`, `query:current_page_dom`, `bookmark:save_from_page` |

### 4.4 Offscreen Document

| File | Changes |
|------|---------|
| `src/offscreen/offscreen.ts` | Remove `FETCH_URL` handler; rename `EXTRACT_CONTENT` to `extract:markdown_from_html` |
| `src/lib/offscreen.ts` | No changes needed (just manages document lifecycle) |

### 4.5 Tab Renderer

| File | Changes |
|------|---------|
| `src/lib/tab-renderer.ts` | Rename to capture intent; return `{ html, title }`; remove platform branching for fetch |

### 4.6 Browser Fetch

| File | Changes |
|------|---------|
| `src/lib/browser-fetch.ts` | Remove offscreen fetch path; always use tab renderer |

### 4.7 Extract Module

| File | Changes |
|------|---------|
| `src/lib/extract.ts` | Update message type to `extract:markdown_from_html` |

### 4.8 UI Components

| File | Changes |
|------|---------|
| `src/popup/popup.ts` | Update `SAVE_BOOKMARK` → `bookmark:save_from_page` |
| `src/library/library.ts` | Update event listeners for new event names |
| `src/search/search.ts` | Update event listeners for new event names |
| `src/stumble/stumble.ts` | Update event listeners for new event names |
| `src/ui/bookmark-detail.ts` | Update `START_PROCESSING` → `bookmark:retry` with payload |
| `src/ui/tag-editor.ts` | Update `TAG_UPDATED` → `tag:added` / `tag:removed` |

### 4.9 Options Page Modules

| File | Changes |
|------|---------|
| `src/options/modules/webdav.ts` | Update sync message types |
| `src/options/modules/bulk-import.ts` | Update `START_BULK_IMPORT` → `import:create_from_url_list` |
| `src/options/modules/jobs.ts` | Update `START_PROCESSING` → `bookmark:retry` |

### 4.10 Jobs Page

| File | Changes |
|------|---------|
| `src/jobs/jobs.ts` | Update `START_PROCESSING` → `bookmark:retry` with payload |

### 4.11 WebDAV Sync

| File | Changes |
|------|---------|
| `src/lib/webdav-sync.ts` | Update event broadcasts to `sync:started`, `sync:completed`, `sync:failed` |

---

## Part 5: Implementation Order

### Phase 1: Type Infrastructure
1. Update `src/lib/messages.ts` with new Command types
2. Update `src/lib/events.ts` with new Event types and payloads
3. Run `npm run typecheck` - expect many errors

### Phase 2: Core Handlers
4. Update `src/background/service-worker.ts` message handlers
5. Update `src/content/capture.ts` message handlers
6. Update `src/offscreen/offscreen.ts` - remove fetch handler, rename extract

### Phase 3: Unified Rendering
7. Update `src/lib/tab-renderer.ts` to return `{ html, title }`
8. Update `src/lib/browser-fetch.ts` to always use tab renderer
9. Update `src/background/processor.ts` to use new return type
10. Remove `FETCH_URL` references from offscreen document

### Phase 4: Event Broadcasting
11. Update `src/background/queue.ts` to broadcast lifecycle events
12. Update `src/lib/webdav-sync.ts` event names

### Phase 5: UI Components
13. Update popup
14. Update library page
15. Update search page
16. Update stumble page
17. Update bookmark detail panel
18. Update tag editor

### Phase 6: Options & Jobs
19. Update options page modules (webdav, bulk-import, jobs)
20. Update jobs page

### Phase 7: Verification
21. Run `npm run typecheck` - should pass
22. Run `npm run lint` - fix any issues
23. Run `npm run test:unit` - verify tests pass
24. Manual testing of all flows

---

## Part 6: Event Flow Diagrams (Post-Refactoring)

### Save Bookmark Flow

```
User clicks "Save" in Popup
         │
         ▼
popup.ts: chrome.scripting.executeScript()
         │
         ▼
[Injected code] → sends: bookmark:save_from_page
         │
         ▼
service-worker.ts: handles bookmark:save_from_page
  ├─→ Insert to IndexedDB
  ├─→ broadcasts: bookmark:created
  └─→ calls startProcessingQueue()
         │
         ▼
queue.ts: processContentQueue()
  ├─→ broadcasts: bookmark:processing_started
  ├─→ extract:markdown_from_html → offscreen
  ├─→ API calls for Q&A + embeddings
  ├─→ broadcasts: bookmark:ready (or bookmark:processing_failed)
  └─→ updates job status
```

### Bulk Import Flow

```
User submits URLs in Options
         │
         ▼
bulk-import.ts → sends: import:create_from_url_list
         │
         ▼
service-worker.ts: handles import:create_from_url_list
  ├─→ Creates job in IndexedDB
  ├─→ broadcasts: job:created
  └─→ calls startProcessingQueue()
         │
         ▼
queue.ts: processFetchQueue()
  For each URL:
    ├─→ browse:capture_dom_and_title (via tab renderer)
    ├─→ Saves HTML + title to bookmark
    ├─→ broadcasts: bookmark:content_fetched
    └─→ broadcasts: job:progress_changed
         │
         ▼
queue.ts: processContentQueue()
  (same as save bookmark flow)
         │
         ▼
broadcasts: job:completed (or job:failed)
```

### Keyboard Shortcut Flow

```
User presses Ctrl+Shift+S
         │
         ▼
service-worker.ts: chrome.commands.onCommand
  └─→ injects: user_request:capture_current_tab
         │
         ▼
capture.ts: handles user_request:capture_current_tab
  └─→ sends: bookmark:save_from_page
         │
         ▼
(continues as Save Bookmark Flow)
```

---

## Part 7: Testing Checklist

### Unit Tests
- [ ] Message type definitions compile correctly
- [ ] Event payloads are type-safe
- [ ] Response types match commands

### Integration Tests
- [ ] Save bookmark from popup works
- [ ] Keyboard shortcut capture works
- [ ] Bulk URL import captures JavaScript-rendered content
- [ ] Retry failed bookmark works with correct trigger payload
- [ ] WebDAV sync broadcasts correct events
- [ ] Tag add/remove broadcasts correct events

### Manual Tests
- [ ] Chrome: Save page with dynamic content (SPA)
- [ ] Chrome: Bulk import 5 URLs
- [ ] Firefox: Save page with dynamic content
- [ ] Firefox: Bulk import 5 URLs
- [ ] Library page updates on bookmark:ready event
- [ ] Search page updates on tag:added event
- [ ] Options page shows sync:started / sync:completed status

---

## Part 8: Rollback Plan

If issues are discovered post-deployment:

1. All changes are in a single feature branch
2. Revert to previous commit on main branch
3. No database migrations required - only code changes
4. Message types are internal - no external API compatibility concerns
