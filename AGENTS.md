# Codebase Architecture

This document provides an overview of the BookmarkRAG codebase structure and architecture.

## Directory Structure

```
src/
├── background/     # Service worker and job processing
├── content/        # Content scripts for page capture
├── db/             # Database layer (Dexie/IndexedDB)
├── jobs/           # Standalone jobs dashboard page
├── lib/            # Shared utilities and adapters
├── library/        # Bookmark library UI
├── offscreen/      # Offscreen document for DOM parsing
├── options/        # Settings page modules
├── popup/          # Browser extension popup
├── search/         # Semantic search implementation
├── shared/         # Shared theme utilities
├── status/         # Health status page
├── stumble/        # Random bookmark discovery
├── ui/             # Shared UI helpers (DOM, tags, health indicator)
├── view/           # Single bookmark detail view
├── web/            # Web standalone initialization
└── welcome/        # First-run welcome page
```

## Background (`src/background/`)

The background module serves as the extension's processing engine, managing asynchronous tasks for bookmark capture, bulk import, and content processing. It coordinates between user-facing UI interactions and background processing while handling service worker interruptions (with initialization guards) and ensuring reliable job completion through persistence and recovery mechanisms.

Key components: `service-worker.ts` acts as the main orchestrator handling Chrome runtime events. `queue.ts` manages pending bookmark processing with timeout detection and retries. `processor.ts` implements the core content processing pipeline (HTML fetching, markdown extraction, summary generation, Q&A generation, and embeddings). `job-resumption.ts` ensures incomplete jobs resume when the service worker restarts.

## Database (`src/db/`)

The application uses Dexie.js (IndexedDB wrapper) to manage a local-first bookmark knowledge base named "BookmarkRAG". The schema consists of nine tables: **bookmarks** (primary content with lifecycle status), **markdown** (processed content), **questionsAnswers** (AI-generated Q&A pairs with vector embeddings), **summaries** (AI-generated summaries with embeddings), **settings** (key-value configuration), **bookmarkTags** (flat tag associations), **searchHistory** (query logging), **jobs** (async operation tracking), and **jobItems** (individual items within bulk jobs).

Data retrieval emphasizes efficient batch operations to prevent N+1 query patterns. Semantic search converts user queries to embeddings, performs vector similarity comparisons, and aggregates results by bookmark with tag filtering support.

## Library (`src/lib/`)

The lib directory contains shared utilities that serve as core infrastructure. The architecture centers on an **adapter pattern** allowing the same business logic to work across browser extensions and web environments. Platform-specific adapters (`extension.ts`, `web.ts`) conform to the `PlatformAdapter` interface, handling storage and API differences transparently.

Key modules: `api.ts` integrates LLM capabilities for semantic enrichment (Q&A generation, summarization, embeddings). `events.ts` provides unified event broadcasting across extension contexts. `jobs.ts` tracks long-running async operations. `server-sync.ts` implements cloud backup with the Localforge sync server. `settings.ts` acts as a facade delegating to the appropriate platform adapter. `url-validator.ts` provides URL validation and hostname extraction.

## Jobs (`src/jobs/`)

The jobs page (`src/jobs/`) provides a standalone dashboard for monitoring and managing async operations. Jobs support hierarchical parent-child relationships via `parentJobId`. Five job types exist: FILE_IMPORT, BULK_URL_IMPORT, URL_FETCH, SYNC_UPLOAD, and SELF_HEAL. Jobs progress through five statuses: PENDING, IN_PROGRESS, COMPLETED, FAILED, and CANCELLED.

The background queue processor continuously polls for pending bookmarks and processes them sequentially. Failed jobs can be retried, and interrupted jobs resume by resetting their status to PENDING.

## Search (`src/search/`)

The search system implements semantic vector-based search where user queries are matched against indexed bookmark content using embeddings. Query embeddings are compared against pre-computed embeddings using cosine similarity, ranking results by semantic relevance rather than keyword matching. The `findTopK` function retrieves top-K results with error handling for dimension mismatches.

Query performance is optimized through bulk database operations. Tag-based post-filtering narrows semantic search results. Search history enables autocomplete, and URL parameters support deep-linking to specific searches.

## Options (`src/options/`)

The options page is structured as seven modular feature areas: **Theme** (five appearance options with real-time application), **Navigation** (sidebar and scroll synchronization via Intersection Observer), **Settings** (OpenAI-compatible API configuration with connection testing), **Import-Export** (JSON backup/restore with duplicate detection), **Server-Sync** (Localforge sync server with token-based authentication), **Bulk-Import** (multi-URL processing with progress tracking), and **Self-Healing** (diagnostics and repair for bookmark data issues).

**Advanced-Config** exposes internal settings similar to Firefox's about:config, allowing developers to modify behavior without code changes.

## UI Components

### Popup (`src/popup/`)
The lightweight extension entry point providing bookmark capture functionality. It extracts the active tab's URL, title, and HTML content, validates against restricted pages, and offers navigation to Library, Search, and Stumble interfaces with an integrated quick-search feature.

### Library (`src/library/`)
The core bookmark management interface with a two-panel layout: sidebar for tag filtering and main content area for bookmark display. Uses event-driven architecture for synchronization (bookmark and tag events trigger UI refresh). Supports tag filtering (All, Untagged, or specific tags), sorting options, and batch tag loading for performance.

### Stumble (`src/stumble/`)
A content discovery feature displaying randomly shuffled bookmarks using Fisher-Yates shuffling. Filters by selected tags and shows only fully-processed bookmarks. Each card displays title, domain, timestamp, and a markdown content preview when available.

## Content Scripts (`src/content/`)

`capture.ts` runs on web pages to collect URL, title, and HTML, communicating with the background service worker via typed message passing with theme-aware toast notifications.

## Web & Offscreen

**Web Mode** (`src/web/`): Enables standalone web application operation by setting a web-specific platform adapter, allowing the same codebase to operate in both extension and web contexts.

**Offscreen Document** (`src/offscreen/`): Workaround for Chrome MV3 limitations where service workers cannot use DOMParser. Handles DOM parsing using Mozilla's Readability library and converts HTML to Markdown using Turndown service.

## Shared (`src/shared/`)

Unified theme management abstracting platform differences. Supports four explicit themes (light, dark, terminal, tufte) plus 'auto' mode respecting OS preferences. Uses the platform adapter pattern to delegate storage operations appropriately for each deployment context.
