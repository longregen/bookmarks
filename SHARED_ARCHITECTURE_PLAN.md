# Shared Architecture Plan: Extension + Web App

## Executive Summary

This plan outlines how to restructure the codebase so the **web app shares maximum code** with the browser extension. The goal is to reduce web-specific code from ~1,000 lines to ~200 lines (an 80% reduction).

## Current State Analysis

### Code Duplication Identified

| Area | Extension Location | Web Duplication | Lines |
|------|-------------------|-----------------|-------|
| Settings | `lib/settings.ts` (IndexedDB) | `web.ts` (localStorage) | ~50 |
| Theme | `shared/theme.ts` (chrome.storage) | `web.ts` (localStorage) | ~50 |
| API calls | `lib/api.ts` | `web.ts` | ~80 |
| Content extraction | `lib/extract.ts` | `web.ts` | ~30 |
| UI (Library/Search/Stumble) | 3 pages (~700 lines) | `web.ts` (monolithic) | ~500 |
| **Total Duplication** | | | **~710 lines** |

### Already Shared (Good!)

- `db/schema.ts` - Dexie database schema
- `lib/similarity.ts` - Cosine similarity functions
- `lib/export.ts` - Import/export utilities
- `shared/theme.css` - CSS design system

---

## Architecture Strategy: Platform Adapters

The key insight: **most code doesn't need browser APIs**. We can create thin adapter interfaces that abstract the platform-specific parts.

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Core (~90%)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ lib/api.ts  │  │ lib/theme.ts│  │ UI Components       │ │
│  │ (pure fetch)│  │ (applyTheme)│  │ (Library/Search/    │ │
│  └─────────────┘  └─────────────┘  │  Stumble pages)     │ │
│         ↑               ↑          └─────────────────────┘ │
│         │               │                    ↑             │
│  ┌──────┴───────────────┴────────────────────┴───────────┐ │
│  │              Platform Adapter Interface                │ │
│  │  • getSettings(): Promise<ApiSettings>                 │ │
│  │  • saveSettings(key, value): Promise<void>             │ │
│  │  • getTheme(): Promise<Theme>                          │ │
│  │  • setTheme(theme): Promise<void>                      │ │
│  │  • fetchContent(url): Promise<{html, finalUrl}>        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          ↑
          ┌───────────────┴───────────────┐
          ↓                               ↓
┌─────────────────────┐        ┌─────────────────────┐
│  Extension Adapter  │        │    Web Adapter      │
│  (~50 lines)        │        │    (~100 lines)     │
│                     │        │                     │
│  • IndexedDB        │        │  • localStorage     │
│  • chrome.storage   │        │  • CORS proxies     │
│  • tabs API         │        │  • direct fetch     │
└─────────────────────┘        └─────────────────────┘
```

---

## Implementation Plan

### Phase 1: Create Platform Adapter Interface

**New file: `src/lib/platform.ts`**

```typescript
// Platform-agnostic interface for storage and fetching
export interface PlatformAdapter {
  // Settings
  getSettings(): Promise<ApiSettings>;
  saveSetting(key: keyof ApiSettings, value: string): Promise<void>;

  // Theme
  getTheme(): Promise<Theme>;
  setTheme(theme: Theme): Promise<void>;

  // Content fetching (optional - only needed for "Add" functionality)
  fetchContent?(url: string): Promise<{ html: string; finalUrl: string }>;
}

// Global adapter instance (set during initialization)
let adapter: PlatformAdapter;

export function setPlatformAdapter(a: PlatformAdapter) {
  adapter = a;
}

export function getPlatformAdapter(): PlatformAdapter {
  if (!adapter) throw new Error('Platform adapter not initialized');
  return adapter;
}
```

**New file: `src/lib/adapters/extension.ts`** (~50 lines)

```typescript
import { db } from '../../db/schema';
import type { PlatformAdapter, ApiSettings, Theme } from '../platform';

export const extensionAdapter: PlatformAdapter = {
  async getSettings() {
    const rows = await db.settings.toArray();
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      apiBaseUrl: map.apiBaseUrl ?? 'https://api.openai.com/v1',
      apiKey: map.apiKey ?? '',
      chatModel: map.chatModel ?? 'gpt-4o-mini',
      embeddingModel: map.embeddingModel ?? 'text-embedding-3-small',
    };
  },

  async saveSetting(key, value) {
    const now = new Date();
    const existing = await db.settings.get(key);
    if (existing) {
      await db.settings.update(key, { value, updatedAt: now });
    } else {
      await db.settings.add({ key, value, createdAt: now, updatedAt: now });
    }
  },

  async getTheme() {
    const result = await chrome.storage.local.get('bookmark-rag-theme');
    return result['bookmark-rag-theme'] || 'auto';
  },

  async setTheme(theme) {
    await chrome.storage.local.set({ 'bookmark-rag-theme': theme });
  },
};
```

**New file: `src/lib/adapters/web.ts`** (~80 lines)

```typescript
import type { PlatformAdapter, ApiSettings, Theme } from '../platform';

const SETTINGS_KEY = 'bookmark-rag-settings';
const THEME_KEY = 'bookmark-rag-theme';

const CORS_PROXIES = [
  { name: 'corsproxy.io', format: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
  { name: 'allorigins', format: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
];

export const webAdapter: PlatformAdapter = {
  async getSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) { /* ignore */ }
    return DEFAULT_SETTINGS;
  },

  async saveSetting(key, value) {
    const current = await this.getSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, [key]: value }));
  },

  async getTheme() {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'auto';
  },

  async setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  },

  async fetchContent(url) {
    // Try direct fetch first
    try {
      const response = await fetch(url);
      if (response.ok) {
        return { html: await response.text(), finalUrl: url };
      }
    } catch { /* fall through to proxies */ }

    // Try CORS proxies
    for (const proxy of CORS_PROXIES) {
      try {
        const response = await fetch(proxy.format(url));
        if (response.ok) {
          return { html: await response.text(), finalUrl: url };
        }
      } catch { continue; }
    }
    throw new Error('Failed to fetch content');
  },
};
```

### Phase 2: Refactor Shared Modules

**Update `lib/api.ts`** to use platform adapter:

```typescript
import { getPlatformAdapter } from './platform';

export async function generateQAPairs(markdownContent: string): Promise<QAPair[]> {
  const settings = await getPlatformAdapter().getSettings();
  // ... rest unchanged
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const settings = await getPlatformAdapter().getSettings();
  // ... rest unchanged
}
```

**Update `shared/theme.ts`** to use platform adapter:

```typescript
import { getPlatformAdapter } from '../lib/platform';

export async function getTheme(): Promise<Theme> {
  return getPlatformAdapter().getTheme();
}

export async function setTheme(theme: Theme): Promise<void> {
  await getPlatformAdapter().setTheme(theme);
  applyTheme(theme);
}

// applyTheme() stays the same - pure DOM manipulation
```

### Phase 3: Reuse UI Pages for Web

The key insight: **Library, Search, and Stumble pages don't use any extension APIs**. They only use:
- `db/schema.ts` (Dexie - works everywhere)
- `lib/similarity.ts` (pure functions)
- DOM manipulation

**Strategy**: Use the same HTML/TS files with platform initialization.

**New file: `src/web/init.ts`** (~20 lines)

```typescript
import { setPlatformAdapter } from '../lib/platform';
import { webAdapter } from '../lib/adapters/web';
import { initTheme } from '../shared/theme';

export async function initWebPlatform() {
  setPlatformAdapter(webAdapter);
  await initTheme();
}
```

**Web entry points** (one per page):

```typescript
// src/web/library.ts (~10 lines)
import { initWebPlatform } from './init';
import { initLibrary } from '../library/library';

initWebPlatform().then(() => initLibrary());
```

### Phase 4: Simplified Web App Structure

**Final web-specific files** (~200 lines total):

```
src/web/
├── init.ts              (20 lines) - Platform initialization
├── add.ts               (100 lines) - "Add URL" functionality (uses CORS proxy)
├── add.html             (50 lines) - Simple form for adding URLs
└── vite.config.web.ts   (30 lines) - Build config
```

**Reused from extension** (0 duplication):

```
src/library/library.html + library.ts  → Reused directly
src/search/search.html + search.ts     → Reused directly
src/stumble/stumble.html + stumble.ts  → Reused directly
src/options/options.html + options.ts  → Reused (settings only)
src/lib/api.ts                         → Reused with adapter
src/lib/similarity.ts                  → Reused directly
src/lib/export.ts                      → Reused directly
src/shared/theme.css                   → Reused directly
src/shared/theme.ts                    → Reused with adapter
src/db/schema.ts                       → Reused directly
```

---

## Migration Steps

1. **Create platform adapter interface** (`lib/platform.ts`)
2. **Create extension adapter** (`lib/adapters/extension.ts`)
3. **Create web adapter** (`lib/adapters/web.ts`)
4. **Refactor `lib/api.ts`** to use adapter
5. **Refactor `shared/theme.ts`** to use adapter
6. **Update extension pages** to initialize adapter on load
7. **Create web entry points** that reuse extension pages
8. **Build web version** with Vite multi-page config
9. **Remove old `web.ts`** monolithic file

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Web-specific code | ~1,000 lines | ~200 lines |
| Code duplication | ~710 lines | ~0 lines |
| Shared code | ~40% | ~95% |
| Maintenance burden | 2 codebases | 1 codebase + adapters |

---

## Benefits

1. **Single source of truth** - UI changes automatically apply to both platforms
2. **Reduced maintenance** - Fix bugs once, works everywhere
3. **Easier testing** - Test shared code once with mocked adapters
4. **Future platforms** - Easy to add mobile/desktop apps with new adapters
5. **Consistent UX** - Same look and behavior across platforms

---

## Web App Navigation

The web app will be a multi-page app (like the extension) rather than an SPA:

```
/web/add.html      → Add new bookmark (web-specific with CORS proxy)
/web/library.html  → Library page (reused from extension)
/web/search.html   → Search page (reused from extension)
/web/stumble.html  → Stumble page (reused from extension)
/web/settings.html → Settings page (reused from extension, minus extension-only options)
```

Navigation between pages uses standard `<a>` links or `window.location.href`, same as extension.

---

## Open Questions

1. **Offline support** - Should web app use Service Worker for offline?
2. **Data sync** - Should web app sync with extension via cloud storage?
3. **Authentication** - Should web app have user accounts for cloud backup?
4. **Hosting** - Where will the web app be hosted? (GitHub Pages, Vercel, etc.)

---

## Conclusion

By introducing a thin **platform adapter layer**, we can share ~95% of the codebase between the extension and web app. The web app becomes a lightweight wrapper that:

1. Initializes the web adapter (localStorage + CORS proxies)
2. Reuses the exact same UI pages from the extension
3. Only adds web-specific functionality (CORS proxy fetching for "Add" feature)

This approach eliminates code duplication, ensures consistent UX, and dramatically reduces maintenance burden.
