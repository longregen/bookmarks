/**
 * Firefox E2E Tests
 *
 * Runs the shared E2E test suite against the Firefox extension.
 * Uses Selenium WebDriver with mock API server for most tests, plus one real API test.
 */

import { FirefoxAdapter } from './adapters/firefox-adapter';
import { TestRunner, runSharedTests } from './e2e-shared';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Firefox Extension E2E Tests');
  console.log('='.repeat(60));
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('Mode: MOCK API (with 1 real API test at the end)');
  console.log('='.repeat(60));

  const adapter = new FirefoxAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();
    await runSharedTests(adapter, runner);
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

  console.log('\n✓ All Firefox E2E tests passed!');
}

main();
