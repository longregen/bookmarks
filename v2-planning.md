# V2 Planning: Jobs System & Bulk URL Import

## Executive Summary

This document outlines the architecture and implementation plan for adding a comprehensive jobs tracking system and bulk URL import functionality to the Bookmark RAG extension.

**Core Features:**
1. Jobs tracking system for all bookmark processing stages
2. Bulk URL import from settings page
3. Real-time job status monitoring UI
4. Background fetching for bulk imports
5. Cross-browser support (Chrome & Firefox)
6. E2E test coverage

---

## 1. Database Schema Changes

### 1.1 New `jobs` Table

```typescript
interface Job {
  id: string;                    // UUID
  type: JobType;                 // See enum below
  status: JobStatus;             // See enum below
  parentJobId?: string;          // For hierarchical jobs (e.g., bulk import -> individual fetches)
  bookmarkId?: string;           // Associated bookmark (if applicable)

  // Progress tracking
  progress: number;              // 0-100
  currentStep?: string;          // Human-readable current step
  totalSteps?: number;           // For multi-step operations
  completedSteps?: number;       // Completed steps count

  // Metadata (flexible JSON)
  metadata: {
    // For MARKDOWN_GENERATION
    characterCount?: number;
    wordCount?: number;
    extractionTimeMs?: number;

    // For QA_GENERATION
    pairsGenerated?: number;
    truncatedChars?: number;
    apiTimeMs?: number;

    // For FILE_IMPORT
    fileName?: string;
    totalBookmarks?: number;
    importedCount?: number;
    skippedCount?: number;

    // For BULK_URL_IMPORT
    totalUrls?: number;
    successCount?: number;
    failureCount?: number;

    // For URL_FETCH
    url?: string;
    fetchTimeMs?: number;
    htmlSize?: number;

    // Common
    errorMessage?: string;
    errorStack?: string;
    retryCount?: number;
  };

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

enum JobType {
  MANUAL_ADD = 'manual_add',
  MARKDOWN_GENERATION = 'markdown_generation',
  QA_GENERATION = 'qa_generation',
  FILE_IMPORT = 'file_import',
  BULK_URL_IMPORT = 'bulk_url_import',
  URL_FETCH = 'url_fetch'
}

enum JobStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}
```

**Database Indexes:**
- Primary: `id`
- Secondary: `bookmarkId`, `parentJobId`, `status`, `type`, `createdAt`, `updatedAt`
- Compound: `[parentJobId, status]`, `[bookmarkId, type]`

**Schema Version:** Bump to version 2 with migration script

---

## 2. Architecture Overview

### 2.1 Component Interaction Diagram

```
┌─────────────────┐
│  Content Script │  (Captures page HTML)
└────────┬────────┘
         │ SAVE_BOOKMARK message
         ▼
┌─────────────────────────────────────────────────────────┐
│                   Service Worker                        │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │ Job Manager  │───▶│   Processor  │───▶│  Queue   │ │
│  └──────────────┘    └──────────────┘    └──────────┘ │
│         │                    │                    │     │
│         ▼                    ▼                    ▼     │
│  ┌──────────────────────────────────────────────────┐  │
│  │              IndexedDB (Dexie)                   │  │
│  │  • bookmarks  • markdown  • qa  • jobs           │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │
         │ FETCH_URLS message (for bulk import)
         ▼
┌─────────────────────────────────────────┐
│      Background Fetch Handler           │
│  (Uses offscreen document on Chrome)    │
│  (Uses background page on Firefox)      │
└─────────────────────────────────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Popup     │    │   Explore   │    │  Settings   │
└─────────────┘    └─────────────┘    └─────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │  Jobs Dashboard  │
                                    │  (new section)   │
                                    └──────────────────┘
```

### 2.2 Core Modules

**New Files to Create:**

1. **`src/lib/jobs.ts`** - Job management library
   - `createJob()` - Create new job entry
   - `updateJob()` - Update job progress/status
   - `completeJob()` - Mark job as completed
   - `failJob()` - Mark job as failed with error
   - `getJobsByBookmark()` - Get all jobs for a bookmark
   - `getJobsByParent()` - Get child jobs
   - `getActiveJobs()` - Get in-progress jobs
   - `getRecentJobs()` - Get recent jobs (last 100)

2. **`src/lib/bulk-import.ts`** - Bulk URL import logic
   - `validateUrls()` - Validate and normalize URL list
   - `createBulkImportJob()` - Create parent job + child jobs
   - `processBulkImport()` - Orchestrate bulk import

3. **`src/background/fetcher.ts`** - URL fetching logic
   - `fetchUrl()` - Fetch single URL with timeout
   - `createFetchHandler()` - Setup fetch message handler
   - Browser-specific implementations

4. **`src/options/jobs.ts`** - Jobs dashboard UI
   - Display job list with filtering
   - Real-time updates via polling
   - Job detail view
   - Cancel/retry actions

5. **`src/options/bulk-import.ts`** - Bulk import UI component
   - Textarea for URL list
   - Validation feedback
   - Import button + progress

**Modified Files:**

1. **`src/db/schema.ts`** - Add jobs table, bump version
2. **`src/background/service-worker.ts`** - Integrate job tracking
3. **`src/background/processor.ts`** - Add job updates throughout processing
4. **`src/lib/export.ts`** - Add job tracking to import
5. **`src/options/options.html`** - Add bulk import section + jobs link
6. **`src/options/options.ts`** - Wire up bulk import UI
7. **`manifest.chrome.json`** - Add offscreen document permission
8. **`manifest.firefox.json`** - Ensure background page support

---

## 3. Detailed Feature Specifications

### 3.1 Job Tracking Integration

#### 3.1.1 Manual Bookmark Addition

**When:** User clicks "Save This Page" or uses keyboard shortcut

**Job Flow:**
1. Create `MANUAL_ADD` job with status `PENDING`
2. Capture HTML via content script
3. Update job to `IN_PROGRESS`
4. Save bookmark to database
5. Update job to `COMPLETED` with metadata:
   ```typescript
   {
     url: string,
     title: string,
     htmlSize: number,
     captureTimeMs: number
   }
   ```
6. Trigger queue processing (creates subsequent jobs)

**Code Location:** `src/content/capture.ts`, `src/background/service-worker.ts`

#### 3.1.2 Markdown Generation

**When:** Bookmark processor extracts markdown

**Job Flow:**
1. Create `MARKDOWN_GENERATION` job linked to bookmark
2. Set status to `IN_PROGRESS`
3. Call `extractMarkdown()`
4. On success:
   - Save markdown to database
   - Update job to `COMPLETED` with metadata:
     ```typescript
     {
       characterCount: number,
       wordCount: number,
       extractionTimeMs: number,
       readabilityScore?: number
     }
     ```
5. On failure:
   - Update job to `FAILED` with error details

**Code Location:** `src/background/processor.ts` (in `processBookmark()`)

#### 3.1.3 Q&A Generation

**When:** Bookmark processor generates Q&A pairs

**Job Flow:**
1. Create `QA_GENERATION` job linked to bookmark
2. Set status to `IN_PROGRESS`
3. Update job with `currentStep: "Generating questions..."`
4. Call chat API
5. Update job with `currentStep: "Generating embeddings..."`
6. Generate embeddings (3 parallel calls)
7. Update job with `currentStep: "Saving Q&A pairs..."`
8. Save pairs to database
9. Update job to `COMPLETED` with metadata:
   ```typescript
   {
     pairsGenerated: number,
     truncatedChars: number,
     apiTimeMs: number,
     embeddingTimeMs: number
   }
   ```

**Code Location:** `src/background/processor.ts` (in `processBookmark()`)

#### 3.1.4 File Import

**When:** User imports JSON file via settings

**Job Flow:**
1. User selects file
2. Create `FILE_IMPORT` job with status `IN_PROGRESS`
3. Parse and validate JSON
4. For each bookmark:
   - Check if exists
   - Import or skip
   - Update job progress: `progress = (processed / total) * 100`
5. Update job to `COMPLETED` with metadata:
   ```typescript
   {
     fileName: string,
     totalBookmarks: number,
     importedCount: number,
     skippedCount: number,
     errorCount: number,
     errors: Array<{ url: string, error: string }>
   }
   ```

**Code Location:** `src/options/options.ts`, `src/lib/export.ts`

### 3.2 Bulk URL Import

#### 3.2.1 User Interface

**Location:** Settings page (`options.html`)

**New Section:**
```html
<section id="bulk-import-section">
  <h2>Bulk Import URLs</h2>
  <p>Paste a list of URLs (one per line) to import multiple bookmarks at once.</p>

  <textarea
    id="bulk-urls-input"
    rows="10"
    placeholder="https://example.com/article1&#10;https://example.com/article2&#10;...">
  </textarea>

  <div id="url-validation-feedback">
    <!-- Shows: X valid URLs, Y invalid URLs -->
  </div>

  <button id="start-bulk-import">Import URLs</button>
  <button id="cancel-bulk-import" style="display:none;">Cancel</button>

  <div id="bulk-import-progress" style="display:none;">
    <progress id="bulk-import-progress-bar" max="100" value="0"></progress>
    <span id="bulk-import-status">Processing...</span>
  </div>
</section>
```

**Validation:**
- Real-time URL validation on input (debounced 500ms)
- Show count of valid/invalid URLs
- Filter out duplicates
- Normalize URLs (add https:// if missing, trim whitespace)
- Warn if >100 URLs (rate limiting concerns)

#### 3.2.2 Bulk Import Processing

**High-Level Flow:**

```typescript
async function startBulkImport(urls: string[]): Promise<string> {
  // 1. Create parent job
  const parentJob = await createJob({
    type: JobType.BULK_URL_IMPORT,
    status: JobStatus.IN_PROGRESS,
    metadata: {
      totalUrls: urls.length,
      successCount: 0,
      failureCount: 0
    }
  });

  // 2. Create child job for each URL
  const childJobs = await Promise.all(
    urls.map(url => createJob({
      type: JobType.URL_FETCH,
      status: JobStatus.PENDING,
      parentJobId: parentJob.id,
      metadata: { url }
    }))
  );

  // 3. Send message to background fetcher
  chrome.runtime.sendMessage({
    type: 'START_BULK_FETCH',
    jobId: parentJob.id,
    childJobIds: childJobs.map(j => j.id)
  });

  return parentJob.id;
}
```

**Background Fetcher:**

**Chrome Implementation (Offscreen Document):**
- Create offscreen document with `fetch` capability
- Message passing between service worker ↔ offscreen doc
- Process URLs in parallel (5 concurrent fetches)
- Return HTML + metadata to service worker

**Firefox Implementation (Background Script):**
- Use persistent background script with `fetch` access
- Same message passing pattern
- Same parallel processing logic

**Fetch Handler Logic:**

```typescript
async function processBulkFetch(parentJobId: string, childJobIds: string[]) {
  const CONCURRENCY = 5;
  const TIMEOUT_MS = 30000;

  for (let i = 0; i < childJobIds.length; i += CONCURRENCY) {
    const batch = childJobIds.slice(i, i + CONCURRENCY);

    await Promise.allSettled(
      batch.map(async (jobId) => {
        const job = await db.jobs.get(jobId);
        const { url } = job.metadata;

        try {
          // Update job status
          await updateJob(jobId, {
            status: JobStatus.IN_PROGRESS
          });

          // Fetch with timeout
          const startTime = Date.now();
          const response = await fetchWithTimeout(url, TIMEOUT_MS);
          const html = await response.text();
          const fetchTimeMs = Date.now() - startTime;

          // Create bookmark (similar to manual add)
          const bookmark = await db.bookmarks.add({
            id: crypto.randomUUID(),
            url,
            title: extractTitleFromHtml(html) || url,
            html,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
          });

          // Update fetch job
          await completeJob(jobId, {
            characterCount: html.length,
            fetchTimeMs,
            htmlSize: html.length,
            bookmarkId: bookmark.id
          });

          // Create MANUAL_ADD job for tracking
          await createJob({
            type: JobType.MANUAL_ADD,
            status: JobStatus.COMPLETED,
            bookmarkId: bookmark.id,
            metadata: {
              url,
              source: 'bulk_import',
              parentJobId
            }
          });

          // Update parent job success count
          await db.jobs.update(parentJobId, (job) => {
            job.metadata.successCount++;
            job.progress = (job.metadata.successCount + job.metadata.failureCount)
                          / job.metadata.totalUrls * 100;
          });

        } catch (error) {
          // Update fetch job as failed
          await failJob(jobId, error);

          // Update parent job failure count
          await db.jobs.update(parentJobId, (job) => {
            job.metadata.failureCount++;
            job.progress = (job.metadata.successCount + job.metadata.failureCount)
                          / job.metadata.totalUrls * 100;
          });
        }
      })
    );
  }

  // Complete parent job
  await completeJob(parentJobId);

  // Trigger queue processing for new bookmarks
  startProcessingQueue();
}
```

**Key Features:**
- Batched parallel fetching (5 at a time)
- 30-second timeout per URL
- Real-time progress updates
- Individual URL failure doesn't stop batch
- Automatic queue processing after import

#### 3.2.3 Post-Import Processing

After bulk import completes:

1. All imported bookmarks have status `pending`
2. Existing queue processor picks them up
3. For each bookmark:
   - `MARKDOWN_GENERATION` job created
   - `QA_GENERATION` job created
   - Jobs tracked as normal

**No changes needed to queue logic** - it already processes pending bookmarks sequentially.

### 3.3 Jobs Dashboard UI

#### 3.3.1 Location Options

**Option A:** New page (`jobs.html`)
- Pros: Dedicated space, can be more complex UI
- Cons: Extra navigation, context switching

**Option B:** Section on settings page
- Pros: Centralized management UI, easy access
- Cons: Page might get crowded

**Recommendation:** Option B (section on settings page) with link to full page if needed

#### 3.3.2 Jobs List UI

**Display:**
- Table with columns: Type | Status | Created | Progress | Details
- Color-coded status badges
- Real-time updates (poll every 2 seconds)
- Filter by: Type, Status, Date range
- Sort by: Created date (default newest first)
- Pagination (50 jobs per page)

**Job Detail View:**
- Click row to expand details
- Show full metadata
- Timeline of status changes (if we track history)
- Associated bookmark link (if applicable)
- Retry button for failed jobs
- Cancel button for in-progress jobs

**Example Wireframe:**

```
┌─────────────────────────────────────────────────────────────┐
│ Jobs                                           [Refresh]     │
├─────────────────────────────────────────────────────────────┤
│ Filter: [All Types ▼] [All Status ▼] [Last 7 Days ▼]       │
├──────────┬──────────┬────────────┬──────────┬──────────────┤
│ Type     │ Status   │ Created    │ Progress │ Details      │
├──────────┼──────────┼────────────┼──────────┼──────────────┤
│ Bulk URL │ ✓ Done   │ 2 min ago  │ 100%     │ 45/45 URLs   │
│ Import   │          │            │          │              │
├──────────┼──────────┼────────────┼──────────┼──────────────┤
│ ├─ Fetch│ ✓ Done   │ 2 min ago  │ 100%     │ example.com  │
│ ├─ Fetch│ ✓ Done   │ 2 min ago  │ 100%     │ github.com   │
│ ├─ Fetch│ ⚠ Failed │ 3 min ago  │ 0%       │ timeout      │
│ └─ ...   │          │            │          │              │
├──────────┼──────────┼────────────┼──────────┼──────────────┤
│ Markdown │ ⚙ Active │ 1 min ago  │ 80%      │ 2,350 chars  │
│ Generate │          │            │          │              │
├──────────┼──────────┼────────────┼──────────┼──────────────┤
│ Q&A Gen  │ ⏸ Pending│ 1 min ago  │ 0%       │ Queued       │
└──────────┴──────────┴────────────┴──────────┴──────────────┘
```

---

## 4. Cross-Browser Implementation

### 4.1 Chrome-Specific Code

**Offscreen Document for Fetching:**

```typescript
// src/background/offscreen-fetch.ts
chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: ['DOM_SCRAPING'],
  justification: 'Fetch URLs for bulk import'
});

// src/offscreen/offscreen.html (new file)
<!DOCTYPE html>
<html>
<head><script src="offscreen.js"></script></head>
<body></body>
</html>

// src/offscreen/offscreen.ts (new file)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_URL') {
    fetchUrl(message.url)
      .then(html => sendResponse({ success: true, html }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open
  }
});
```

**Manifest Addition:**
```json
{
  "permissions": ["offscreen"]
}
```

### 4.2 Firefox-Specific Code

**Background Script:**

Firefox MV3 supports persistent background scripts, so we can use `fetch` directly in the service worker.

**No special code needed** - use same fetch logic as offscreen document.

### 4.3 Unified Abstraction

**Create browser-agnostic fetch utility:**

```typescript
// src/lib/browser-fetch.ts
export async function browserFetch(url: string): Promise<string> {
  if (isFirefox()) {
    // Direct fetch in Firefox service worker
    const response = await fetch(url);
    return await response.text();
  } else {
    // Use offscreen document in Chrome
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_URL', url },
        (response) => {
          if (response.success) {
            resolve(response.html);
          } else {
            reject(new Error(response.error));
          }
        }
      );
    });
  }
}

function isFirefox(): boolean {
  return navigator.userAgent.includes('Firefox');
}
```

---

## 5. Implementation Plan

### Phase 1: Database & Core Infrastructure (Day 1-2)

**Tasks:**
1. ✓ Create jobs table schema in `src/db/schema.ts`
2. ✓ Write database migration to version 2
3. ✓ Implement job management functions in `src/lib/jobs.ts`
4. ✓ Write unit tests for job functions
5. ✓ Update `db.ts` exports

**Testing:**
- Can create jobs with all types
- Can update jobs with progress
- Can query jobs by bookmark/parent/status
- Migration preserves existing data

### Phase 2: Job Tracking Integration (Day 3-4)

**Tasks:**
1. ✓ Add `MANUAL_ADD` job creation in `service-worker.ts`
2. ✓ Add `MARKDOWN_GENERATION` job tracking in `processor.ts`
3. ✓ Add `QA_GENERATION` job tracking in `processor.ts`
4. ✓ Add `FILE_IMPORT` job tracking in `export.ts`
5. ✓ Test each integration point

**Testing:**
- Manual bookmark save creates job
- Markdown generation updates job with char count
- Q&A generation tracks all steps
- File import shows progress

### Phase 3: Bulk Import Backend (Day 5-7)

**Tasks:**
1. ✓ Create `src/lib/bulk-import.ts` with validation
2. ✓ Implement Chrome offscreen document fetcher
3. ✓ Implement Firefox background fetcher
4. ✓ Create browser-agnostic fetch wrapper
5. ✓ Add bulk import message handler to service worker
6. ✓ Test with 10, 50, 100 URLs
7. ✓ Handle edge cases (timeouts, 404s, redirects)

**Testing:**
- 10 URLs import successfully
- Failed fetches don't block others
- Progress updates correctly
- Bookmarks get queued for processing

### Phase 4: Jobs Dashboard UI (Day 8-9)

**Tasks:**
1. ✓ Create jobs HTML section in `options.html`
2. ✓ Implement jobs list rendering in `options.ts`
3. ✓ Add filtering and sorting
4. ✓ Add real-time polling updates
5. ✓ Create job detail expand/collapse
6. ✓ Style with consistent CSS

**Testing:**
- Jobs display correctly
- Filters work
- Real-time updates work
- Detail view shows metadata

### Phase 5: Bulk Import UI (Day 10)

**Tasks:**
1. ✓ Add bulk import section to `options.html`
2. ✓ Implement URL validation and feedback
3. ✓ Wire up import button to backend
4. ✓ Add progress bar and status display
5. ✓ Handle success/error states

**Testing:**
- Validation catches invalid URLs
- Progress bar updates during import
- Success message shows stats
- Errors display helpfully

### Phase 6: E2E Testing (Day 11-12)

**Tasks:**
1. ✓ Add test for bulk URL import in `e2e.test.ts`
2. ✓ Test jobs dashboard displays jobs
3. ✓ Test Chrome-specific offscreen document
4. ✓ Test Firefox-specific background script
5. ✓ Test error scenarios
6. ✓ Update CI configuration

**Test Cases:**
- Import 5 URLs successfully
- Failed fetch shows in jobs as failed
- Jobs appear in dashboard
- Parent-child job relationships work
- Imported bookmarks get processed

### Phase 7: Documentation & Polish (Day 13-14)

**Tasks:**
1. ✓ Update README with new features
2. ✓ Add JSDoc comments to new functions
3. ✓ Create user guide for bulk import
4. ✓ Add error handling improvements
5. ✓ Performance testing with 100+ URLs
6. ✓ Code review and refactoring

---

## 6. Technical Considerations

### 6.1 Performance

**Bulk Import Scaling:**
- **100 URLs**: ~2-3 minutes (5 concurrent fetches)
- **500 URLs**: ~15-20 minutes
- **1000 URLs**: ~30-40 minutes

**Optimizations:**
- Increase concurrency to 10 (risk of rate limits)
- Add pause/resume functionality
- Allow user-configurable batch size

**Database Performance:**
- Jobs table will grow quickly (3 jobs per bookmark)
- Add auto-cleanup: delete jobs older than 30 days
- Keep only failed jobs indefinitely for debugging

### 6.2 Error Handling

**Fetch Failures:**
- Network timeouts (30s limit)
- 404/403/500 responses
- CORS issues (can't be solved, mark as failed)
- Invalid HTML (malformed, empty)

**Processing Failures:**
- API rate limits (handle 429 with exponential backoff)
- API errors (5xx from OpenAI)
- Markdown extraction failures
- Embedding generation failures

**Job Recovery:**
- Stuck jobs detection (in progress >1 hour)
- Automatic retry for transient errors (network)
- Manual retry button for failed jobs
- Cancel in-progress jobs

### 6.3 User Experience

**Progress Visibility:**
- Real-time progress bars
- Estimated time remaining (based on avg fetch time)
- Desktop notification on completion
- Error notifications with retry options

**Bulk Import UX:**
- Warn before starting large imports (>100 URLs)
- Show validation errors before starting
- Allow cancel during import
- Show detailed results (success/fail counts)

**Jobs Dashboard UX:**
- Clear status indicators (icons + colors)
- Helpful error messages
- Quick actions (retry, cancel, delete)
- Export job history as CSV

### 6.4 Storage Considerations

**Jobs Table Growth:**
- 1000 bookmarks × 3 jobs = 3000 job records
- Average job size: ~500 bytes (metadata varies)
- Total: ~1.5 MB for 1000 bookmarks
- Not significant compared to embeddings (~50 MB for 1000 bookmarks)

**Cleanup Strategy:**
- Auto-delete completed jobs >30 days old
- Keep failed jobs indefinitely (user may want to investigate)
- Keep in-progress jobs indefinitely (may be stuck)
- Add "Clear All Completed Jobs" button in dashboard

### 6.5 Security Considerations

**URL Validation:**
- Reject `javascript:` URLs
- Reject `data:` URLs (already HTML, no need to fetch)
- Reject local file URLs (`file://`)
- Only allow `http://` and `https://`

**Fetch Safety:**
- Timeout after 30 seconds
- Limit response size (max 10 MB HTML)
- Don't execute JavaScript (plain fetch, not browser)
- Sanitize HTML before storage (though we store as-is currently)

**Rate Limiting:**
- Warn user about API costs for large imports
- Consider adding user-configurable rate limits
- Add "pause" button to stop import if costs spike

---

## 7. Testing Strategy

### 7.1 Unit Tests

**New Test Files:**
1. `tests/jobs.test.ts` - Job CRUD operations
2. `tests/bulk-import.test.ts` - URL validation, job creation
3. `tests/browser-fetch.test.ts` - Mock browser fetch

**Coverage Goals:**
- Jobs library: 100%
- Bulk import validation: 100%
- Browser fetch: 80% (mocking limitations)

### 7.2 Integration Tests

**Test Scenarios:**
1. Create manual bookmark → verify MANUAL_ADD job created
2. Process bookmark → verify MARKDOWN + QA jobs created
3. Import JSON file → verify FILE_IMPORT job created
4. Bulk import 3 URLs → verify parent + 3 child jobs
5. Failed fetch → verify job marked as failed

### 7.3 E2E Tests

**New E2E Test: Bulk Import**

```typescript
async function testBulkImport() {
  // 1. Navigate to settings
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  // 2. Enter URLs
  const urls = [
    'https://example.com',
    'https://httpbin.org/html',
    'https://www.wikipedia.org'
  ];
  await page.type('#bulk-urls-input', urls.join('\n'));

  // 3. Validate shows 3 valid URLs
  await page.waitForSelector('#url-validation-feedback');
  const validationText = await page.$eval('#url-validation-feedback', el => el.textContent);
  assert(validationText.includes('3 valid URLs'));

  // 4. Start import
  await page.click('#start-bulk-import');

  // 5. Wait for progress to complete
  await page.waitForFunction(
    () => document.querySelector('#bulk-import-progress-bar')?.value === 100,
    { timeout: 60000 }
  );

  // 6. Verify jobs created
  const db = await openDatabase();
  const jobs = await db.jobs.where('type').equals('BULK_URL_IMPORT').toArray();
  assert(jobs.length === 1);
  assert(jobs[0].status === 'completed');

  // 7. Verify child jobs
  const childJobs = await db.jobs.where('parentJobId').equals(jobs[0].id).toArray();
  assert(childJobs.length === 3);

  // 8. Verify bookmarks created
  const bookmarks = await db.bookmarks.toArray();
  assert(bookmarks.length >= 3);

  // 9. Wait for processing (markdown + Q&A)
  await waitForCondition(
    async () => {
      const complete = await db.bookmarks.where('status').equals('complete').count();
      return complete >= 3;
    },
    120000 // 2 minutes
  );

  // 10. Verify all job types exist
  const mdJobs = await db.jobs.where('type').equals('MARKDOWN_GENERATION').toArray();
  const qaJobs = await db.jobs.where('type').equals('QA_GENERATION').toArray();
  assert(mdJobs.length >= 3);
  assert(qaJobs.length >= 3);
}
```

### 7.4 Browser-Specific Testing

**Chrome:**
- Test offscreen document creation
- Test message passing to offscreen
- Test multiple concurrent offscreen operations

**Firefox:**
- Test background script fetch
- Test same functionality as Chrome
- Verify no manifest errors with `web-ext lint`

**CI:**
- Run Chrome tests on Ubuntu with Puppeteer
- Run Firefox tests with `web-ext run` (headless mode)
- Separate jobs for each browser

---

## 8. Migration Strategy

### 8.1 Database Migration

**From Version 1 to Version 2:**

```typescript
// src/db/schema.ts
const db = new Dexie('BookmarkRAG');

db.version(1).stores({
  bookmarks: 'id, url, status, createdAt, updatedAt',
  markdown: 'id, bookmarkId, createdAt, updatedAt',
  questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
  settings: 'key, createdAt, updatedAt'
});

db.version(2).stores({
  bookmarks: 'id, url, status, createdAt, updatedAt',
  markdown: 'id, bookmarkId, createdAt, updatedAt',
  questionsAnswers: 'id, bookmarkId, createdAt, updatedAt',
  settings: 'key, createdAt, updatedAt',
  jobs: 'id, bookmarkId, parentJobId, status, type, createdAt, updatedAt, [parentJobId+status], [bookmarkId+type]'
}).upgrade(async tx => {
  // Migration logic if needed
  // Create retrospective jobs for existing bookmarks?
  // Probably not - just start fresh with new jobs
  console.log('Upgraded to version 2 with jobs table');
});
```

**User Impact:**
- Seamless upgrade on extension update
- No data loss
- Jobs table starts empty (no historical jobs)

### 8.2 Feature Rollout

**Phase 1: Soft Launch**
- Release with jobs tracking only (no bulk import yet)
- Monitor for bugs in job creation
- Gather feedback on jobs UI

**Phase 2: Bulk Import Beta**
- Enable bulk import behind feature flag
- Test with power users (10-20 URLs)
- Monitor performance and errors

**Phase 3: Full Release**
- Remove feature flag
- Update documentation
- Announce in release notes

---

## 9. Future Enhancements

### 9.1 Job System Improvements

**Job History & Analytics:**
- Show processing time trends over time
- Average markdown char count per domain
- Success rate by domain
- API usage statistics

**Advanced Job Features:**
- Job priorities (high/normal/low)
- Job dependencies (don't start Q&A until markdown done)
- Scheduled jobs (import URLs at specific time)
- Recurring jobs (fetch URL weekly for updates)

**Job Actions:**
- Bulk retry failed jobs
- Bulk cancel pending jobs
- Duplicate job detection
- Job templates (save bulk import lists)

### 9.2 Bulk Import Enhancements

**Source Options:**
- Import from browser bookmarks (use `chrome.bookmarks` API)
- Import from RSS feed
- Import from sitemap.xml
- Import from browser history (last N days)

**Smart Fetching:**
- Detect paywalls/login required
- Use reader mode extraction before saving
- Deduplicate by content hash (not just URL)
- Extract canonical URLs from pages

**Batch Configuration:**
- User-configurable concurrency
- User-configurable timeout
- Retry strategy configuration
- Domain-specific delays (respect robots.txt)

### 9.3 UI Enhancements

**Jobs Dashboard:**
- Realtime updates via WebSocket (if we add backend)
- Timeline view (Gantt chart of jobs)
- Job search/filter by URL
- Export job history as JSON/CSV

**Bulk Import:**
- Drag-and-drop text file with URLs
- Preview what will be imported
- Exclude patterns (e.g., skip URLs matching regex)
- Import from clipboard

**Notifications:**
- Desktop notifications for job completion
- Email notifications for large imports (requires backend)
- Slack/Discord webhooks (requires settings)

---

## 10. Open Questions & Decisions Needed

### 10.1 Technical Decisions

**Q1: Should we implement job history (status change tracking)?**
- Pro: Better debugging, audit trail
- Con: More storage, more complexity
- **Decision:** No for V2, add in future if needed

**Q2: Should we retry failed fetches automatically?**
- Pro: More reliable imports
- Con: Longer import times, harder to debug
- **Decision:** No auto-retry, only manual retry button

**Q3: Should we add job expiration/cleanup?**
- Pro: Prevent database bloat
- Con: Lose historical data
- **Decision:** Yes, auto-delete completed jobs >30 days

**Q4: Should bulk import queue bookmarks or process immediately?**
- Pro queue: More control, better for large imports
- Con queue: More complexity
- **Decision:** Process immediately, use existing queue

**Q5: How to handle duplicate URLs in bulk import?**
- Option A: Skip silently
- Option B: Skip with warning
- Option C: Update existing bookmark HTML
- **Decision:** Option C (update HTML, re-process)

### 10.2 UX Decisions

**Q6: Where should jobs dashboard live?**
- Option A: Separate page
- Option B: Section in settings
- Option C: Tab in explore page
- **Decision:** Option B (settings section) with link to full page

**Q7: Should we show job notifications?**
- Pro: User awareness
- Con: Notification fatigue
- **Decision:** Yes, but only for:
  - Bulk import completion
  - Large job failures (>10 items)
  - User-initiated actions

**Q8: Should we allow canceling in-progress jobs?**
- Pro: User control
- Con: Partial state cleanup needed
- **Decision:** Yes for bulk import, no for individual bookmark processing

---

## 11. Success Metrics

### 11.1 Feature Adoption

- % of users who try bulk import in first week
- Average number of URLs per bulk import
- % of bulk imports that complete successfully
- % of users who view jobs dashboard

### 11.2 Performance Metrics

- Average fetch time per URL
- Average processing time (markdown + Q&A) per bookmark
- Success rate for fetches
- Success rate for markdown extraction
- Success rate for Q&A generation

### 11.3 Error Metrics

- Top 5 fetch error types (timeout, 404, CORS, etc.)
- Top 5 processing error types
- Average retry count for failed jobs
- % of jobs that eventually succeed after retry

---

## 12. Rollback Plan

### 12.1 If Jobs System Fails

**Symptoms:**
- High database errors
- Performance degradation
- Jobs not creating/updating

**Rollback:**
1. Release hotfix that disables job creation
2. Keep existing processing flow working
3. Add database migration to remove jobs table (optional)

**Data Loss:**
- Only job history (not critical)
- All bookmarks/markdown/Q&A preserved

### 12.2 If Bulk Import Fails

**Symptoms:**
- Fetches timing out
- Service worker crashes
- Offscreen document errors

**Rollback:**
1. Remove bulk import UI from settings
2. Disable message handlers for bulk import
3. Leave jobs system intact (works independently)

**Data Loss:**
- In-progress bulk imports cancelled
- Already-imported bookmarks preserved

---

## 13. Documentation Requirements

### 13.1 User-Facing Documentation

**README Updates:**
- Add "Bulk Import" section with screenshots
- Add "Jobs Dashboard" section
- Update feature list

**User Guide:**
- How to bulk import URLs
- How to interpret job statuses
- How to retry failed jobs
- Troubleshooting common errors

### 13.2 Developer Documentation

**Code Comments:**
- JSDoc for all new public functions
- Inline comments for complex logic
- Architecture decision records (ADRs)

**API Documentation:**
- Job interface specifications
- Message passing protocol for fetcher
- Database schema documentation

---

## 14. Timeline Summary

**Total Estimated Time: 14 days (2 weeks)**

- Phase 1: Database & Infrastructure (2 days)
- Phase 2: Job Tracking Integration (2 days)
- Phase 3: Bulk Import Backend (3 days)
- Phase 4: Jobs Dashboard UI (2 days)
- Phase 5: Bulk Import UI (1 day)
- Phase 6: E2E Testing (2 days)
- Phase 7: Documentation & Polish (2 days)

**Dependencies:**
- Must complete Phase 1 before Phase 2
- Must complete Phase 2 before Phase 3
- Phase 4 and 5 can be done in parallel with Phase 3
- Phase 6 requires Phases 3, 4, 5 complete

**Risk Buffer: +3 days** for unexpected issues

**Final Timeline: 17 days (3.5 weeks)**

---

## 15. Conclusion

This plan provides a comprehensive roadmap for adding a robust jobs tracking system and bulk URL import feature to the Bookmark RAG extension. The architecture is designed to be:

- **Scalable**: Handle hundreds of URLs without degradation
- **Reliable**: Comprehensive error handling and retry logic
- **User-friendly**: Clear progress indicators and helpful errors
- **Cross-browser**: Works on Chrome and Firefox with same UX
- **Testable**: Full E2E test coverage
- **Maintainable**: Clean abstractions and well-documented code

The phased implementation approach allows for incremental delivery and reduces risk. Each phase builds on the previous, with clear testing checkpoints.

Key success factors:
1. Thorough testing at each phase
2. Clear user feedback during operations
3. Robust error handling for network operations
4. Cross-browser compatibility from day one
5. Performance optimization for large imports

Next steps:
1. Review and approve this plan
2. Begin Phase 1 implementation
3. Set up tracking for success metrics
4. Schedule regular progress check-ins
