# Project: Bookmark RAG Extension

A browser extension for capturing and semantically searching bookmarks using RAG (Retrieval-Augmented Generation).

## Commands

```bash
npm run build:chrome # Chrome extension
npm run build:firefox # Firefox extension
npm run build:web # standalone webapp
npm run typecheck
npm run lint
npm run check # Typecheck + lint in parallel
npm run test:unit # unit tests
npm run test:e2e:chrome # E2E tests (Puppeteer)
npm run test:e2e:firefox # E2E tests (Selenium)
```

## Key Directories

The codebase is organized under `src/` with modules for background processing, database, search, UI, and shared utilities. See [AGENTS.md](./AGENTS.md) for the complete directory structure and detailed module documentation.

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

## E2E Tests

### Chrome Setup

```bash
mkdir -p /tmp/chromium && cd /tmp/chromium && \
  wget -q "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/$(wget -qO- https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/LAST_CHANGE)/chrome-linux.zip" && \
  unzip -q chrome-linux.zip

```

### Firefox Setup

```bash
mkdir -p /tmp/firefox && cd /tmp/firefox && \
  curl -L -o firefox.tar.bz2 "https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=en-US" && \
  tar -xf firefox.tar.bz2

curl -L -o /tmp/geckodriver.tar.gz \
  "https://github.com/mozilla/geckodriver/releases/download/v0.36.0/geckodriver-v0.36.0-linux64.tar.gz" && \
  tar -xzf /tmp/geckodriver.tar.gz -C /usr/local/bin/
```

### Run tests

```
# Firefox
npm run build:firefox && \
  BROWSER_PATH=/tmp/firefox/firefox/firefox OPENAI_API_KEY=not-needed-for-tests \
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" npm run test:e2e:firefox
# Chrome
npm run build:chrome && \
  BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed-for-tests \
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" npm run test:e2e:chrome 
```
