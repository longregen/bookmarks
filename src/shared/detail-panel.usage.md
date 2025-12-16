# Detail Panel Component - Usage Guide

## Overview

The `detail-panel.ts` component provides a shared, reusable detail panel that can be used across Library, Search, and Stumble pages. It follows the UX specifications from `REDESIGN.md`.

## File Location

**File:** `/home/user/bookmarks/src/shared/detail-panel.ts`

## Features

### ✓ Implemented

1. **Back Button** - "← Back" button at the top
2. **Article Title** - Large, bold title
3. **Full URL** - Clickable, linkable URL with target="_blank"
4. **Time + Status** - Smart date formatting with status indicator
5. **Tags Section** - Placeholder for future tag-editor integration
6. **Markdown Content** - Rendered with proper typography
7. **Q&A Pairs** - Expandable section (default: expanded)
8. **Action Buttons** - Debug HTML, Export, Delete
9. **Processing Info** - Expandable section (default: collapsed)

### Date Formatting (per REDESIGN.md)

- **< 2 weeks**: Relative time (e.g., "2h ago", "3 days ago")
- **< 12 months**: Month and day (e.g., "Oct 12")
- **≥ 12 months**: Full date (e.g., "2024-12-24")

### Status Indicators

- `○` Pending (gray)
- `◐` Processing with % (blue)
- `●` Complete (green)
- `✕` Error (red)

## Usage

### 1. Import the component

```typescript
import { createDetailPanel, injectDetailPanelStyles } from '../shared/detail-panel.js';
import { db } from '../db/schema.js';
```

### 2. Inject styles (once per page)

```typescript
// Call this once when the page loads
injectDetailPanelStyles();
```

### 3. Create a detail panel

```typescript
async function showBookmarkDetail(bookmarkId: string) {
  // Fetch bookmark data
  const bookmark = await db.bookmarks.get(bookmarkId);
  if (!bookmark) return;

  const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

  // Create the detail panel
  const panel = createDetailPanel({
    bookmark,
    markdown,
    qaPairs,
    onClose: () => {
      // Handle close action (e.g., hide panel, navigate back)
      detailContainer.innerHTML = '';
      detailContainer.style.display = 'none';
    },
    onDelete: async (bookmarkId) => {
      // Handle delete action
      await db.markdown.where('bookmarkId').equals(bookmarkId).delete();
      await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).delete();
      await db.bookmarks.delete(bookmarkId);

      // Close panel and refresh list
      detailContainer.innerHTML = '';
      detailContainer.style.display = 'none';
      refreshBookmarkList();
    },
    onExport: async (bookmark) => {
      // Handle export action
      const exportData = await exportSingleBookmark(bookmark.id);
      downloadExport(exportData);
    },
    onDebugHtml: (bookmark) => {
      // Handle debug HTML action (show raw HTML)
      showDebugOverlay(bookmark);
    },
    onTagsChange: (bookmarkId, tags) => {
      // Optional: Handle tag changes (for future tag-editor integration)
      console.log('Tags changed:', bookmarkId, tags);
    }
  });

  // Add panel to DOM
  detailContainer.innerHTML = '';
  detailContainer.appendChild(panel);
  detailContainer.style.display = 'flex';
}
```

### 4. Example HTML container

```html
<div id="detailContainer" style="display: none;">
  <!-- Detail panel will be inserted here -->
</div>
```

## CSS Integration

The component uses CSS variables from `theme.css`:

- **Layout**: `flex: 1`, `max-width: 680px`
- **Spacing**: Uses `--space-*` variables
- **Colors**: Uses theme-aware color variables
- **Typography**: Uses `--text-*` and `--font-*` variables
- **Transitions**: Uses `--transition-*` variables

The styles are automatically injected via `injectDetailPanelStyles()`.

## CSP-Safe Implementation

The component is Firefox extension-friendly:

- Uses `createElement()` from `dom.ts` for CSP compliance
- Markdown rendering uses `DOMParser` in Firefox (no `innerHTML`)
- All event handlers properly attached via `addEventListener()`

## Interface

```typescript
export interface DetailPanelOptions {
  bookmark: Bookmark;              // Required: The bookmark to display
  markdown?: Markdown;              // Optional: Markdown content
  qaPairs?: QuestionAnswer[];       // Optional: Q&A pairs
  onClose: () => void;              // Required: Close handler
  onDelete: (bookmarkId: string) => void;  // Required: Delete handler
  onExport: (bookmark: Bookmark) => void;  // Required: Export handler
  onDebugHtml: (bookmark: Bookmark) => void; // Required: Debug handler
  onTagsChange?: (bookmarkId: string, tags: string[]) => void; // Optional: Tag change handler
}
```

## Future Integration

### Tag Editor

The component includes a placeholder for the tag-editor component:

```typescript
// Currently shows:
"[Tags placeholder - will be replaced by tag-editor component]"

// Future integration:
// When tag-editor.ts is created, replace the placeholder section with:
const tagEditor = createTagEditor({
  bookmarkId: bookmark.id,
  initialTags: currentTags,
  onChange: (tags) => {
    if (options.onTagsChange) {
      options.onTagsChange(bookmark.id, tags);
    }
  }
});
tagsSection.appendChild(tagEditor);
```

## Example: Migrating from explore.ts

### Before (explore.ts lines 141-216):

```typescript
async function showBookmarkDetail(bookmarkId: string) {
  // ... fetch data ...

  detailContent.textContent = '';
  detailContent.appendChild(createElement('h1', { textContent: bookmark.title }));
  // ... manual DOM construction ...
}
```

### After (using detail-panel component):

```typescript
import { createDetailPanel, injectDetailPanelStyles } from '../shared/detail-panel.js';

// Initialize once
injectDetailPanelStyles();

async function showBookmarkDetail(bookmarkId: string) {
  const bookmark = await db.bookmarks.get(bookmarkId);
  const markdown = await db.markdown.where('bookmarkId').equals(bookmarkId).first();
  const qaPairs = await db.questionsAnswers.where('bookmarkId').equals(bookmarkId).toArray();

  const panel = createDetailPanel({
    bookmark,
    markdown,
    qaPairs,
    onClose: closeDetail,
    onDelete: deleteCurrentBookmark,
    onExport: exportCurrentBookmark,
    onDebugHtml: debugCurrentBookmarkHtml,
  });

  detailContent.textContent = '';
  detailContent.appendChild(panel);
  showDetailView();
}
```

## Testing

To test the component:

1. Build the project: `npm run build`
2. Load the extension in Chrome/Firefox
3. Navigate to Library, Search, or Stumble page
4. Click on a bookmark card
5. Verify all sections render correctly
6. Test expand/collapse for Q&A and Processing Info
7. Test action buttons (Debug, Export, Delete)

## Notes

- The component is stateless and pure (no internal state management)
- All interactions are handled via callbacks
- Expandable sections maintain their own internal state
- The component is responsive and works across all screen sizes
- Maximum width is 680px as specified in REDESIGN.md
