# Project: Bookmark RAG Extension

A browser extension for capturing and semantically searching bookmarks using RAG (Retrieval-Augmented Generation).

## Build Commands

```bash
npm run build:chrome      # Build Chrome extension
npm run build:firefox     # Build Firefox extension
npm run build:web         # Build web standalone
npm run test:unit         # Run unit tests
npm run typecheck         # TypeScript type checking
npm run lint              # ESLint
npm run check             # typecheck + lint (parallel)
```

## Architecture Overview

See [AGENTS.md](./AGENTS.md) for detailed module documentation.

| Directory | Purpose |
|-----------|---------|
| `src/background/` | Service worker, job queue, processor, fetcher |
| `src/db/` | Dexie schema, IndexedDB operations |
| `src/lib/` | Core utilities, API, adapters, state management |
| `src/search/` | Vector similarity, embedding search |
| `src/options/` | Settings page modules |
| `src/popup/` | Extension popup UI |
| `src/library/` | Bookmark library interface |
| `src/content/` | Page capture scripts |

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

## When Making Changes

1. **Reduce complexity** - Simplify code while preserving functionality
2. **Remove dead code** - Delete unused functions, variables, imports
3. **Use lib helpers** - Always check `src/lib/` for existing utilities
4. **Leverage tree shaking** - Structure code for dead code elimination
5. **Optimize queries** - Avoid N+1 patterns in database operations
6. **Verify assumptions** - Research external APIs and browser behaviors
