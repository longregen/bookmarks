# Performance Analysis Report

## Executive Summary

This analysis identified **35+ performance issues** across the codebase in four categories:
- **N+1 Database Queries**: 7 critical/high severity issues
- **Inefficient Algorithms**: 6 medium/low severity issues
- **UI Rendering Problems**: 13 issues causing unnecessary reflows
- **Memory Leaks**: 9 issues with uncleaned resources

---

## 1. N+1 Database Query Anti-Patterns

### CRITICAL

#### 1.1 Export: Sequential bookmark content fetching
**File:** `src/lib/export.ts:56-59`

```typescript
for (const bookmark of bookmarks) {
  const { markdown, qaPairs } = await getBookmarkContent(bookmark.id);  // N+1
  exportedBookmarks.push(formatBookmarkForExport(bookmark, markdown, qaPairs));
}
```

**Impact:** Exporting 100 bookmarks = 300+ sequential database operations.

**Fix:** Batch load all content upfront:
```typescript
const bookmarkIds = bookmarks.map(b => b.id);
const markdowns = await db.markdowns.where('bookmarkId').anyOf(bookmarkIds).toArray();
const qaPairs = await db.questionsAnswers.where('bookmarkId').anyOf(bookmarkIds).toArray();
// Build lookup maps for O(1) access
```

#### 1.2 Import: Sequential QA pair insertion
**File:** `src/lib/export.ts:155-179`

```typescript
for (const qa of questionsAnswers) {
  await db.questionsAnswers.add(questionAnswer);  // N+1
}
```

**Fix:** Use `db.questionsAnswers.bulkAdd(qaPairsArray)`.

#### 1.3 Processor: Sequential QA insertion
**File:** `src/background/processor.ts:75-87`

Same pattern as above - individual `db.questionsAnswers.add()` calls in a loop.

### HIGH

#### 1.4 Bulk import: Query + update per URL
**File:** `src/lib/bulk-import.ts:69-95`

```typescript
for (const url of urls) {
  const existing = await db.bookmarks.where('url').equals(url).first();  // N+1
  if (!existing) {
    await db.bookmarks.add({...});  // N+1
  } else {
    await db.bookmarks.update(existing.id, {...});  // N+1
  }
}
```

**Fix:** Load all existing URLs first, batch insert/update:
```typescript
const existing = await db.bookmarks.where('url').anyOf(urls).toArray();
const existingUrls = new Set(existing.map(b => b.url));
const toInsert = urls.filter(u => !existingUrls.has(u)).map(url => ({...}));
await db.bookmarks.bulkAdd(toInsert);
```

#### 1.5 Jobs: Double sequential updates
**File:** `src/lib/jobs.ts:188-206`

```typescript
for (const item of items) {
  await db.jobItems.update(item.id, {...});  // N updates
}
for (const bookmarkId of bookmarkIds) {
  await db.bookmarks.update(bookmarkId, {...});  // N more updates
}
```

**Fix:** Collect updates and use transactions or `Promise.all()`.

#### 1.6 Stumble: Individual QA pair fetching
**File:** `src/stumble/stumble.ts:97-126`

```typescript
for (const bookmark of selected) {
  const qaPairs = await getBookmarkQAPairs(bookmark.id);  // N+1
}
```

#### 1.7 Jobs UI: Individual bookmark lookups
**File:** `src/jobs/jobs.ts:198-201`

```typescript
for (const item of items) {
  const bookmark = await db.bookmarks.get(item.bookmarkId);  // N+1
}
```

---

## 2. Inefficient Algorithms

### MEDIUM

#### 2.1 Search: Recalculating max scores during sort
**File:** `src/search/search.ts:240-241`

```typescript
.sort((a, b) => Math.max(...b[1].map(r => r.score)) - Math.max(...a[1].map(r => r.score)));
```

**Issue:** O(n log n) comparisons × O(m) map operations each.

**Fix:** Pre-compute max scores before sorting.

#### 2.2 Job statistics: Four filter passes
**File:** `src/lib/jobs.ts:149-156`

```typescript
return {
  pending: items.filter(i => i.status === 'pending').length,
  inProgress: items.filter(i => i.status === 'in_progress').length,
  complete: items.filter(i => i.status === 'complete').length,
  error: items.filter(i => i.status === 'error').length,
};
```

**Fix:** Single reduce pass:
```typescript
const stats = items.reduce((acc, i) => {
  acc[i.status]++;
  return acc;
}, { pending: 0, in_progress: 0, complete: 0, error: 0 });
```

#### 2.3 Library: Load all then filter
**File:** `src/library/library.ts:108-119`

Loads all bookmarks to memory, then filters by tag. Should query only needed bookmarks.

### LOW

#### 2.4 HTML entity decoding: 9 sequential replaces
**File:** `src/lib/bulk-import.ts:112-122`

```typescript
return text
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  // ... 7 more replaces
```

**Fix:** Single replace with lookup function.

#### 2.5 Bulk import progress: Two filter passes
**File:** `src/options/modules/bulk-import.ts:68-69`

```typescript
const completed = bookmarks.filter(b => b.status === 'complete' || b.status === 'error').length;
const errors = bookmarks.filter(b => b.status === 'error').length;
```

---

## 3. UI Rendering Issues

### CRITICAL

#### 3.1 Layout thrashing in navigation
**File:** `src/options/modules/navigation.ts:45-56`

```typescript
const handleScroll = (): void => {
  const containerTop = scrollContainer.getBoundingClientRect().top;
  for (const section of sections) {
    const sectionTop = section.getBoundingClientRect().top;  // Layout read in loop
  }
}
```

**Fix:** Use Intersection Observer or cache layout reads before loop.

### HIGH - Missing Document Fragments

These locations append elements one-by-one in loops instead of batching:

| File | Lines | Description |
|------|-------|-------------|
| `src/library/library.ts` | 75-99 | Tag list rendering |
| `src/library/library.ts` | 125-172 | Bookmark cards |
| `src/search/search.ts` | 109-134 | Autocomplete dropdown |
| `src/search/search.ts` | 276-291 | Search results |
| `src/stumble/stumble.ts` | 97-126 | Stumble cards |
| `src/options/modules/jobs.ts` | 11-51 | Jobs list |
| `src/options/modules/advanced-config.ts` | 110-131 | Config table |
| `src/ui/tag-filter.ts` | 10-46 | Tag filters |
| `src/ui/tag-editor.ts` | 57-83 | Tag dropdown |
| `src/ui/bookmark-detail.ts` | 56-125 | Detail panel content |
| `src/options/modules/import-export.ts` | 73-78 | Error list |

**Fix Pattern:**
```typescript
// Before: Individual appends
for (const item of items) {
  container.appendChild(createElement(...));
}

// After: Use document fragment
const fragment = document.createDocumentFragment();
for (const item of items) {
  fragment.appendChild(createElement(...));
}
container.appendChild(fragment);
```

### MEDIUM

#### 3.2 Missing event delegation
**File:** `src/options/modules/jobs.ts:11-51`

Individual click listeners added to each job element instead of delegating to parent.

#### 3.3 Polling without change detection
**File:** `src/options/modules/bulk-import.ts:58-104`

DOM updates every second even if values haven't changed:
```typescript
bulkImportProgressBar.style.width = `${percent}%`;
bulkImportStatus.textContent = `...`;
```

---

## 4. Memory Leaks & Resource Issues

### CRITICAL

#### 4.1 Service worker: Permanent event listeners
**File:** `src/background/service-worker.ts:61-180`

Five event listeners added but never removed:
- `chrome.runtime.onInstalled` (line 61)
- `chrome.runtime.onStartup` (line 66)
- `chrome.alarms.onAlarm` (line 73)
- `chrome.runtime.onMessage` (line 84)
- `chrome.commands.onCommand` (line 157)

**Note:** In service workers, these may re-register on restart.

#### 4.2 Jobs page: Uncleaned setInterval
**File:** `src/jobs/jobs.ts:369-371`

```typescript
setInterval(() => {
  void loadJobs();
}, 5000);  // NEVER cleared
```

**Fix:** Store interval ID and clear on page unload.

#### 4.3 Search: Global keydown listener not removed
**File:** `src/search/search.ts:348-368`

```typescript
document.addEventListener('keydown', (e) => {...});  // Never removed

window.addEventListener('beforeunload', () => {
  removeEventListener();  // Only removes bookmark listener
});
```

### MAJOR

#### 4.4 Health indicator cleanup not called
**Files:** `src/library/library.ts:214`, `src/search/search.ts:357`

```typescript
createHealthIndicator(healthIndicatorContainer);  // Returns cleanup fn, but not stored
```

The returned cleanup function is never called, leaving intervals running.

#### 4.5 Library: Unreliable interval cleanup
**File:** `src/library/library.ts:202-210`

Cleanup depends on `beforeunload` which may not fire reliably.

---

## Priority Recommendations

### Immediate (High Impact)

1. **Batch database operations** in export.ts, bulk-import.ts, jobs.ts, processor.ts
2. **Fix setInterval leak** in jobs.ts:369
3. **Add document fragments** in library.ts and search.ts
4. **Fix layout thrashing** in navigation.ts

### Short-term (Medium Impact)

5. **Pre-compute values** before sorting in search.ts
6. **Single-pass statistics** in jobs.ts
7. **Event delegation** for job items
8. **Proper cleanup** for health indicators

### Long-term (Lower Impact)

9. **Query optimization** - only load needed bookmarks
10. **String operation consolidation**
11. **Change detection** before DOM updates
12. **Intersection Observer** for scroll handling

---

## Summary Table

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| N+1 Queries | 3 | 4 | - | - |
| Algorithms | - | - | 3 | 3 |
| UI Rendering | 1 | 11 | 1 | - |
| Memory Leaks | 3 | 2 | 2 | 2 |
| **Total** | **7** | **17** | **6** | **5** |
