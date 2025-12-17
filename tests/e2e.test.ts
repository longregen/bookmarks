/**
 * Chrome E2E Tests
 *
 * Runs the shared E2E test suite against the Chrome extension.
 * Uses Puppeteer with mock API server for most tests, plus one real API test.
 *
 * Coverage collection:
 *   Set E2E_COVERAGE=true to collect coverage during tests.
 *   Coverage will be written to coverage-e2e/ directory.
 *   Run `npm run coverage:merge` to merge with unit test coverage.
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, runSharedTests } from './e2e-shared';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Chrome Extension E2E Tests');
  console.log('='.repeat(60));
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log(`Coverage: ${process.env.E2E_COVERAGE === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log('Mode: MOCK API (with 1 real API test at the end)');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    // Start coverage collection if supported
    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    await runSharedTests(adapter, runner);

    // Stop coverage collection
    if (adapter.stopCoverage) {
      await adapter.stopCoverage();
    }

    // Write coverage data
    if (adapter.writeCoverage) {
      await adapter.writeCoverage();
    }
  } catch (error) {
    console.error('\nFatal error:', error);
  } finally {
    await adapter.teardown();
  }

  runner.printSummary(adapter.platformName);

  if (runner.isEmpty()) {
    console.error('\n✗ No tests were executed! This indicates a setup failure.');
    process.exit(1);
  }

  if (runner.hasFailures()) {
    process.exit(1);
  }

  console.log('\n✓ All Chrome E2E tests passed!');
}

main();
