# Project: Bookmark RAG Extension

A browser extension for capturing and semantically searching bookmarks using RAG (Retrieval-Augmented Generation).

## Commands

```bash
npm run build:chrome   # Build Chrome extension
npm run build:firefox  # Build Firefox extension
npm run build:web      # Build standalone webapp
npm run test:unit      # Run unit tests
npm run typecheck      # TypeScript typechecker
npm run lint           # ESLint
npm run check          # Typecheck + lint in parallel
npm run e2e:chrome     # E2E tests (Puppeteer)
npm run e2e:firefox    # E2E tests (Selenium)
```

## Key Directories

```
src/
├── background/   # Service worker, job queue, content processor
├── db/           # Dexie/IndexedDB schema and queries
├── lib/          # Shared utilities, adapters, API client
├── search/       # Semantic vector search
├── options/      # Settings page modules
├── library/      # Bookmark management UI
└── content/      # Content scripts for page capture
```

See [AGENTS.md](./AGENTS.md) for detailed module documentation.

## Forbidden Directories

Do not read or modify: `node_modules/`, `dist/`, `dist-*/`, `coverage/`

## Code Conventions

- TypeScript strict mode, ES2022 target
- Dexie for IndexedDB, Readability for content extraction
- Platform adapter pattern: `src/lib/adapters/` (extension vs web)
- Avoid N+1 queries: use batch operations from `src/db/`

## Code Style

- Keep comments minimal - code should be self-documenting
- Prefer concise, readable implementations
- Use existing helpers from `src/lib/` (e.g., `getElement`, `createElement`, `getErrorMessage`)

## Workflow

Before modifying code:
1. **Explore** - Read relevant files, understand existing patterns
2. **Plan** - For multi-file changes, outline the approach first
3. **Implement** - Make changes incrementally
4. **Test** - Run `npm run check` and add tests in `tests/`

## When Making Changes

- **Use lib helpers** - Check `src/lib/` for existing utilities before writing new ones
- **Optimize queries** - Use batch operations from `src/db/`, avoid N+1 patterns
- **Remove dead code** - Delete unused functions, variables, imports
- **Verify assumptions** - Research external APIs and browser behaviors

## Running E2E Tests Locally

Prerequisites: Download Chromium from `storage.googleapis.com`, install xvfb (`apt install xvfb`)

```bash
npm run build:chrome
BROWSER_PATH=/path/to/chrome OPENAI_API_KEY=not-needed-for-tests \
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
  npm run e2e:chrome
```

Note: Claude can only run Chromium tests (not Firefox).
