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

## Running E2E Tests Locally

### Prerequisites

- **Chrome/Chromium**: Download from `storage.googleapis.com` or install via package manager
- **Firefox**: Download from Mozilla or install via package manager
- **geckodriver**: Required for Firefox tests (download from GitHub releases)
- **xvfb**: Required for headless display (`apt install xvfb`)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BROWSER_PATH` | Yes | Path to browser executable |
| `OPENAI_API_KEY` | Yes | API key (can be mock for most tests) |
| `EXTENSION_PATH` | No | Custom extension path (defaults to `dist-chrome` or `dist-firefox`) |
| `E2E_COVERAGE` | No | Set to `true` to collect coverage |

### Chrome E2E Tests

```bash
# 1. Build the extension
npm run build:chrome

# 2. Run tests (requires display or xvfb)
BROWSER_PATH=/path/to/chrome OPENAI_API_KEY=your-key \
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
  npm run test:e2e:chrome
```

### Firefox E2E Tests

```bash
# 1. Build the extension
npm run build:firefox

# 2. Ensure geckodriver is in PATH
export PATH=$PATH:/path/to/geckodriver

# 3. Run tests
BROWSER_PATH=/path/to/firefox OPENAI_API_KEY=your-key \
  xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
  npm run test:e2e:firefox
```

### Downloading Chromium (if not installed)

```bash
# Get latest revision
REVISION=$(curl -s https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/LAST_CHANGE)

# Download and extract
curl -L "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/${REVISION}/chrome-linux.zip" -o chrome.zip
unzip chrome.zip
# Browser at: ./chrome-linux/chrome
```

### Test Structure

- Most tests use a **mock API server** (no real API calls)
- One test at the end uses the **real OpenAI API** to verify connectivity
- Tests run in headed mode (extensions require it) with xvfb providing virtual display
