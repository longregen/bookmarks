# Project: Bookmark RAG Extension

A browser extension for capturing and semantically searching bookmarks using RAG (Retrieval-Augmented Generation).

## Build Commands
npm run `build:chrome` builds the Chrome extension, `build:firefox` builds the Firefox extension, `build:web` builds a standalone webapp, `test:unit` runs the unit tests, `typecheck` the TypeScript typechecker, `lint` the configured ESLint, `check` typechecks and lints in parallel, `e2e:chrome` runs end-to-end tests with Puppeteer, `e2e:firefox` uses Selenium.

## Architecture Overview

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

## When Making Changes

1. **Reduce complexity** - Simplify code while preserving functionality
2. **Remove dead code** - Delete unused functions, variables, imports
3. **Use lib helpers** - Always check `src/lib/` for existing utilities
4. **Leverage tree shaking** - Structure code for dead code elimination
5. **Optimize queries** - Avoid N+1 patterns in database operations
6. **Verify assumptions** - Research external APIs and browser behaviors
7. **Ensure test coverage** - Add tests that cover the new code

## Running E2E Tests

```bash
# Setup: download Chromium, install xvfb
mkdir -p /tmp/chromium && cd /tmp/chromium && \
  wget -qO- https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/LAST_CHANGE | \
  xargs -I{} wget -q "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/{}/chrome-linux.zip" && \
  unzip -q chrome-linux.zip

# Run
npm run build:chrome && BROWSER_PATH=/tmp/chromium/chrome-linux/chrome \
  xvfb-run --auto-servernum npm run test:e2e:chrome
```
