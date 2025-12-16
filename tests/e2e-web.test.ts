/**
 * Web E2E Tests
 *
 * Runs the shared E2E test suite against the standalone web application.
 * Uses Puppeteer with mock API server. Real API tests are skipped for web
 * since the web app doesn't have reliable access to the API key in CI.
 */

import { WebAdapter } from './adapters/web-adapter';
import { TestRunner, runSharedTests } from './e2e-shared';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Web App E2E Tests');
  console.log('='.repeat(60));
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('Mode: MOCK API only (real API tests skipped for web)');
  console.log('='.repeat(60));

  const adapter = new WebAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();
    await runSharedTests(adapter, runner, { skipRealApiTests: true });
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

  console.log('\n✓ All Web E2E tests passed!');
}

main();
