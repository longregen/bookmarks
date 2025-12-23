# Codebase Architecture

This document provides an overview of the BookmarkRAG codebase structure and architecture.

## Directory Structure

```
src/
├── background/     # Service worker and job processing
├── content/        # Content scripts for page capture
├── db/             # Database layer (Dexie/IndexedDB)
├── jobs/           # Job type definitions
├── lib/            # Shared utilities and adapters
├── library/        # Bookmark library UI
├── offscreen/      # Offscreen document for DOM parsing
├── options/        # Settings page modules
├── popup/          # Browser extension popup
├── search/         # Semantic search implementation
├── shared/         # Shared theme utilities
├── stumble/        # Random bookmark discovery
└── web/            # Web standalone initialization
```

## Background (`src/background/`)

The background module serves as the extension's processing engine, managing asynchronous tasks for bookmark capture, bulk import, and content processing. It coordinates between user-facing UI interactions and background processing while handling service worker interruptions and ensuring reliable job completion through persistence and recovery mechanisms.

Key components: `service-worker.ts` acts as the main orchestrator handling Chrome runtime events. `queue.ts` manages pending bookmark processing with timeout detection and retries. `processor.ts` implements the core content processing pipeline (markdown extraction, Q&A generation, embeddings). `fetcher.ts` handles batch URL downloading for bulk imports. `job-resumption.ts` ensures incomplete jobs resume when the service worker restarts.

## Database (`src/db/`)

The application uses Dexie.js (IndexedDB wrapper) to manage a local-first bookmark knowledge base named "BookmarkRAG". The schema consists of seven interconnected tables: **bookmarks** (primary content with lifecycle status), **markdown** (processed content), **questionsAnswers** (AI-generated Q&A pairs with 1536-dimensional vector embeddings), **settings** (key-value configuration), **bookmarkTags** (hierarchical tag associations), **searchHistory** (query logging), and **jobs** (async operation tracking).

Data retrieval emphasizes efficient batch operations to prevent N+1 query patterns. Semantic search converts user queries to embeddings, performs vector similarity comparisons, and aggregates results by bookmark with tag filtering support.

## Library (`src/lib/`)

The lib directory contains shared utilities that serve as core infrastructure. The architecture centers on an **adapter pattern** allowing the same business logic to work across browser extensions and web environments. Platform-specific adapters (`extension.ts`, `web.ts`) conform to the `PlatformAdapter` interface, handling storage and API differences transparently.

Key modules: `api.ts` integrates LLM capabilities for semantic enrichment. `events.ts` provides unified broadcasting across tabs. `jobs.ts` tracks long-running async operations. `state-manager.ts` handles operation state with timeout detection. `webdav-sync.ts` implements cloud backup with conflict resolution. `settings.ts` acts as a facade delegating to the appropriate platform adapter.

## Jobs (`src/jobs/`)

The job system is a background processing framework tracking long-running operations with hierarchical parent-child relationships. Six job types exist: MANUAL_ADD, MARKDOWN_GENERATION, QA_GENERATION, FILE_IMPORT, BULK_URL_IMPORT, and URL_FETCH. Jobs progress through five statuses: PENDING, IN_PROGRESS, COMPLETED, FAILED, and CANCELLED.

The background queue processor continuously polls for pending jobs and processes them sequentially. Failed jobs can be retried with exponential backoff, and interrupted jobs resume by resetting their status to PENDING. Completed jobs are automatically cleaned up after 30 days.

## Search (`src/search/`)

The search system implements semantic vector-based search where user queries are matched against indexed bookmark content using embeddings. Query embeddings are compared against pre-computed embeddings using cosine similarity, ranking results by semantic relevance rather than keyword matching. The `findTopK` function retrieves top-K results with error handling for dimension mismatches.

Query performance is optimized through bulk database operations. Tag-based post-filtering narrows semantic search results. Search history enables autocomplete, and URL parameters support deep-linking to specific searches.

## Options (`src/options/`)

The options page is structured as seven modular feature areas: **Theme** (five appearance options with real-time application), **Navigation** (sidebar and scroll synchronization via Intersection Observer), **Settings** (OpenAI-compatible API configuration with connection testing), **Import-Export** (JSON backup/restore with duplicate detection), **WebDAV** (cloud sync configuration and status polling), **Bulk-Import** (multi-URL processing with progress tracking), and **Jobs** (async operation history with filtering).

**Advanced-Config** exposes internal settings similar to Firefox's about:config, allowing developers to modify behavior without code changes.

## UI Components

### Popup (`src/popup/`)
The lightweight extension entry point providing bookmark capture functionality. It extracts the active tab's URL, title, and HTML content, validates against restricted pages, and offers navigation to Library, Search, and Stumble interfaces with an integrated quick-search feature.

### Library (`src/library/`)
The core bookmark management interface with a two-panel layout: sidebar for tag filtering and main content area for bookmark display. Uses event-driven architecture with 30-second fallback polling for synchronization. Supports multi-level filtering, sorting options, and batch tag loading for performance.

### Stumble (`src/stumble/`)
A content discovery feature displaying randomly shuffled bookmarks using Fisher-Yates shuffling. Filters by selected tags and shows only fully-processed bookmarks. Each card displays title, domain, timestamp, and a random Q&A pair when available.

## Content Scripts (`src/content/`)

Two key modules: `capture.ts` runs on web pages to collect URL, title, and HTML, communicating with the background service worker via message passing with theme-aware toast notifications. `extract-html.ts` handles async page content extraction by monitoring DOM mutations and waiting for page settling before returning fully rendered HTML.

## Web & Offscreen

**Web Mode** (`src/web/`): Enables standalone web application operation by setting a web-specific platform adapter, allowing the same codebase to operate in both extension and web contexts.

**Offscreen Document** (`src/offscreen/`): Workaround for Chrome MV3 limitations where service workers cannot use DOMParser. Handles DOM parsing using Mozilla's Readability library and converts HTML to Markdown using Turndown service.

## Shared (`src/shared/`)

Unified theme management abstracting platform differences. Supports four explicit themes (light, dark, terminal, tufte) plus 'auto' mode respecting OS preferences. Uses the platform adapter pattern to delegate storage operations appropriately for each deployment context.
