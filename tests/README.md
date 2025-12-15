# Test Suite

This directory contains comprehensive tests for the Bookmark RAG extension, covering unit tests, integration tests, and E2E tests.

## Test Files

### Unit Tests

#### `jobs.test.ts`
Comprehensive unit tests for the jobs management library (`src/lib/jobs.ts`).

**Coverage:**
- ✅ `createJob()` - Job creation with various parameters
- ✅ `updateJob()` - Job status and progress updates
- ✅ `completeJob()` - Marking jobs as completed with metadata
- ✅ `failJob()` - Handling job failures with error details
- ✅ `cancelJob()` - Canceling in-progress jobs
- ✅ `getJobsByBookmark()` - Querying jobs by bookmark ID
- ✅ `getJobsByParent()` - Retrieving child jobs
- ✅ `getActiveJobs()` - Finding in-progress jobs
- ✅ `getRecentJobs()` - Filtering and querying recent jobs
- ✅ `cleanupOldJobs()` - Automatic job cleanup
- ✅ `getJobStats()` - Job statistics

**Test Count:** 40+ tests

#### `bulk-import.test.ts`
Unit tests for bulk URL import functionality (`src/lib/bulk-import.ts`).

**Coverage:**
- ✅ `validateSingleUrl()` - Individual URL validation
- ✅ `validateUrls()` - Batch URL validation
- ✅ `createBulkImportJob()` - Parent and child job creation
- ✅ `extractTitleFromHtml()` - HTML title extraction
- ✅ `bookmarkExists()` - Duplicate detection
- ✅ `getExistingUrls()` - Bulk existence checking

**Test Count:** 30+ tests

**Security Tests:**
- Rejection of `javascript:` URLs
- Rejection of `data:` URLs
- Rejection of `file:` URLs
- Protocol validation (HTTP/HTTPS only)

#### `browser-fetch.test.ts`
Unit tests for browser-agnostic fetch wrapper (`src/lib/browser-fetch.ts`).

**Coverage:**
- ✅ `fetchWithTimeout()` - URL fetching with timeout
- ✅ `browserFetch()` - Cross-browser fetch abstraction
- ✅ Timeout handling
- ✅ Error handling (network, HTTP errors, size limits)
- ✅ Chrome offscreen document integration
- ✅ Firefox direct fetch support

**Test Count:** 25+ tests

**Edge Cases:**
- Timeout handling
- 10 MB size limit enforcement
- HTTP error codes (404, 500, etc.)
- Network failures
- SSL certificate errors
- Connection refused

### Integration Tests

#### `extension.test.ts`
Integration tests for the extension UI and basic functionality.

**Coverage:**
- ✅ Popup page loads
- ✅ Options page loads
- ✅ Explore page loads
- ✅ API configuration
- ✅ API connection testing
- ✅ Search UI functionality
- ✅ View switching

**Test Count:** 8 tests

### E2E Tests

#### `e2e.test.ts`
End-to-end tests for complete user workflows.

**Coverage:**
- ✅ API configuration and testing
- ✅ Bookmark saving workflow
- ✅ Bookmark processing (markdown + Q&A)
- ✅ Search functionality
- ✅ View switching
- ✅ Stats display
- ✅ **Bulk URL import** (NEW)
- ✅ **Jobs dashboard display** (NEW)
- ✅ **Jobs filtering** (NEW)
- ✅ **Export/Import UI** (NEW)
- ✅ **URL validation** (NEW)
- ✅ **Jobs auto-refresh** (NEW)

**Test Count:** 15 tests

## Running Tests

### Run All Unit Tests
```bash
npm run test:unit
```

### Run Unit Tests in Watch Mode
```bash
npm run test:unit:watch
```

### Run Unit Tests with Coverage
```bash
npm run test:unit:coverage
```

### Run Integration Tests
```bash
npm run test
```

### Run E2E Tests

#### Chrome E2E Tests
```bash
BROWSER_TYPE=chrome \
BROWSER_PATH=/path/to/chrome \
EXTENSION_PATH=dist-chrome \
OPENAI_API_KEY=your-key \
npm run test:e2e:chrome
```

#### Firefox E2E Tests
```bash
BROWSER_PATH=/path/to/firefox \
EXTENSION_PATH=dist-firefox \
OPENAI_API_KEY=your-key \
npm run test:e2e:firefox
```

Firefox E2E tests use Selenium WebDriver with GeckoDriver for reliable extension testing.

### Run All Tests
```bash
npm run test:all
```

## Test Coverage Goals

Based on v2-planning.md specifications:

| Module | Goal | Actual | Status |
|--------|------|--------|--------|
| `jobs.ts` | 100% | ~95%+ | ✅ |
| `bulk-import.ts` | 100% | ~95%+ | ✅ |
| `browser-fetch.ts` | 80% | ~85%+ | ✅ |

## Test Configuration

### `vitest.config.ts`
Configures Vitest for unit tests:
- Uses `jsdom` environment for browser APIs
- Includes coverage reporting (v8)
- Excludes E2E tests from unit test runs

### `setup.ts`
Test setup file that:
- Mocks Chrome extension APIs
- Configures Dexie for in-memory IndexedDB
- Provides `crypto.randomUUID()` mock
- Cleans up test databases

## Test Structure

### Unit Tests
- Use Vitest with `jsdom` environment
- Mock browser APIs (Chrome extension, fetch)
- Test pure functions and database operations
- Fast execution (~100ms per test)

### Integration Tests
- Use Puppeteer with real browser
- Test extension UI loading
- Verify component interactions
- Medium execution time (~2-5s per test)

### E2E Tests
- Use Puppeteer with full extension
- Test complete user workflows
- Verify end-to-end functionality
- Slow execution (~10-30s per test)

## Writing New Tests

### Unit Test Example
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/db/schema';
import { myFunction } from '../src/lib/my-module';

describe('My Module', () => {
  beforeEach(async () => {
    await db.myTable.clear();
  });

  afterEach(async () => {
    await db.myTable.clear();
  });

  it('should do something', async () => {
    const result = await myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### E2E Test Example
```typescript
await runTest('My feature works', async () => {
  const page = await browser!.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);

  await page.waitForSelector('#myElement', { timeout: 5000 });
  await page.click('#myButton');

  const result = await page.$eval('#output', el => el.textContent);
  expect(result).toBe('expected');

  await page.close();
});
```

## CI/CD Integration

Tests are run in GitHub Actions:
- Unit tests run on every push
- Integration tests run on pull requests
- E2E tests run on main branch merges
- Coverage reports uploaded to artifacts

## Firefox E2E Test Status

The e2e test suite supports both Chrome and Firefox browsers with reliable testing infrastructure.

### Current Status

- ✅ **Chrome E2E tests** (`e2e.test.ts`) - Uses Puppeteer, works reliably in all environments
- ✅ **Firefox E2E tests** (`e2e-firefox.test.ts`) - Uses Selenium WebDriver, works reliably in all environments
- ✅ **Firefox extension tests** (non-e2e) - Work using web-ext

### Technical Details

**Chrome E2E Tests:**
- Framework: Puppeteer
- File: `tests/e2e.test.ts`
- Extension protocol: `chrome-extension://`

**Firefox E2E Tests:**
- Framework: Selenium WebDriver with GeckoDriver
- File: `tests/e2e-firefox.test.ts`
- Extension protocol: `moz-extension://`
- Extension packaging: Automatically creates XPI from extension directory
- UUID detection: Dynamically detects extension UUID from `about:debugging`

### Why Selenium for Firefox?

Puppeteer's Firefox support via WebDriver BiDi cannot interact with `moz-extension://` pages, making it unsuitable for Firefox extension testing. Selenium WebDriver with GeckoDriver provides full support for:
- Navigation to `moz-extension://` pages
- Extension installation and management
- Complete extension API testing

### CI Workflow

Both Chrome and Firefox E2E tests run in GitHub Actions:
- Firefox tests use Selenium with GeckoDriver
- Tests fail the build if they encounter errors (no `continue-on-error`)
- Full test coverage across both browsers

## Troubleshooting

### Unit Tests Failing
- Check if Dexie database is properly cleared between tests
- Verify mocks are reset in `beforeEach`
- Ensure `crypto.randomUUID()` mock is working

### E2E Tests Failing
- Verify `BROWSER_PATH` environment variable
- Check extension build is up to date (`npm run build:chrome`)
- Ensure headless Chrome is properly installed
- Check for race conditions (add longer waits)

### Coverage Not 100%
- Some error paths may be hard to test
- Defensive code may not be reachable
- Browser-specific code requires different test environments

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Puppeteer Documentation](https://pptr.dev/)
- [Dexie Testing Guide](https://dexie.org/docs/Tutorial/Testing)
