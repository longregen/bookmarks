# Project: Bookmark RAG Extension

A browser extension for capturing and semantically searching bookmarks using RAG (Retrieval-Augmented Generation).

## Commands

```bash
npm run build:chrome # Chrome extension
npm run build:firefox # Firefox extension
npm run build:web # standalone webapp
npm run typecheck
npm run lint
npm run check # npm ci + typecheck + lint in parallel
npm run test:unit # unit tests
npm run test:e2e:chrome # E2E tests (Puppeteer)
npm run test:e2e:firefox # E2E tests (Selenium)
```

## Key Directories

```
src/
├── background/ # Service worker, job queue, content processor
├── content/    # Content scripts for page capture
├── db/         # Dexie/IndexedDB schema and queries
├── jobs/       # Standalone jobs dashboard page
├── lib/        # Shared utilities, adapters, API client
├── library/    # Bookmark management UI
├── offscreen/  # Offscreen document for DOM parsing (Chrome MV3)
├── options/    # Settings page modules
├── popup/      # Browser extension popup
├── search/     # Semantic vector search
├── shared/     # Theme management
├── status/     # Health status page
├── stumble/    # Random bookmark discovery
├── ui/         # Shared UI helpers (DOM, tags, health indicator)
├── view/       # Single bookmark detail view
├── web/        # Web standalone initialization
└── welcome/    # First-run welcome page
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
- Use existing helpers from `src/ui/dom.ts` (e.g., `getElement`, `createElement`) and `src/lib/` (e.g., `getErrorMessage`)

## Workflow

Before modifying code:
1. **Explore** - Read relevant files, understand existing patterns
2. **Plan** - For multi-file changes, outline the approach first
3. **Implement** - Make changes incrementally
4. **Test** - Run `npm run check` and add tests in `tests/`

Always set npm environment to development so that all dependencies get installed.

## When Making Changes

- **Use lib helpers** - Check `src/lib/` and `src/ui/` for existing utilities before writing new ones
- **Optimize queries** - Use batch operations from `src/db/`, avoid N+1 patterns
- **Remove dead code** - Delete unused functions, variables, imports
- **Verify assumptions** - Research external APIs and browser behaviors

## Running E2E Tests (NixOS)

Requires `nix-shell` with `xvfb-run`, `chromium`, and `patchelf` (for wrangler's workerd binary).

```bash
# Build first
npm run build:chrome

# Run all E2E tests (deno + wrangler + no-server)
nix-shell -p xvfb-run chromium patchelf --run \
  "BROWSER_PATH=\$(which chromium) OPENAI_API_KEY=not-needed-for-tests \
  xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' \
  npm run test:e2e:chrome"

# Skip specific servers
SKIP_WRANGLER=1  # skip wrangler tests
SKIP_DENO=1      # skip deno tests

# Screenshots only
nix-shell -p xvfb-run chromium --run \
  "BROWSER_PATH=\$(which chromium) \
  xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' \
  npm run screenshots"
```

The test script auto-installs `server/` dependencies and patches the workerd binary for NixOS when needed.
