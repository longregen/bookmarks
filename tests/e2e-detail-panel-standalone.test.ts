/**
 * Standalone Detail Panel E2E Tests
 * Run only detail panel tests without running the full test suite
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner } from './e2e-shared';
import { runDetailPanelTests } from './e2e-detail-panel';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Detail Panel E2E Tests (Chrome)');
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    if (adapter.startCoverage) {
      await adapter.startCoverage();
    }

    // Run detail panel tests
    await runDetailPanelTests(adapter, runner);

    if (adapter.stopCoverage) {
      await adapter.stopCoverage();
    }

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

  console.log('\n✓ All Detail Panel E2E tests passed!');
}

main();
