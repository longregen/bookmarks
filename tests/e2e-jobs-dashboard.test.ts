/**
 * E2E Tests for Jobs Dashboard Filtering
 *
 * Tests the Jobs dashboard filtering functionality, including:
 * - Filtering jobs by type (FILE_IMPORT, BULK_URL_IMPORT, URL_FETCH)
 * - Filtering jobs by status (PENDING, IN_PROGRESS, COMPLETED, FAILED)
 * - Combined type AND status filtering
 * - Refresh button functionality
 * - Filter persistence after refresh
 * - Empty state when no jobs match filters
 *
 * Usage:
 *   npm run build:chrome && \
 *   BROWSER_PATH=/tmp/chromium/chrome-linux/chrome OPENAI_API_KEY=not-needed \
 *   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
 *   npm run test:e2e:jobs-dashboard
 */

import { ChromeAdapter } from './adapters/chrome-adapter';
import { TestRunner, TestAdapter, PageHandle } from './e2e-shared';
import { JobType, JobStatus } from '../src/db/schema';

interface JobsTestContext {
  adapter: TestAdapter;
  page: PageHandle;
}

async function setupJobsInDatabase(page: PageHandle): Promise<void> {
  // Helper to create test jobs directly in the database
  // We'll use the library page because it has access to the db module
  await page.goto((page as any).adapter?.getPageUrl('library') || '');
  await page.waitForSelector('#bookmarkList');

  // Create test jobs with different types and statuses
  await page.evaluate(`
    (async () => {
      const { db, JobType, JobStatus } = await import('/src/db/schema.ts');

      // Clear existing jobs first
      await db.jobs.clear();

      // Create jobs with different type/status combinations
      const testJobs = [
        // File Import jobs
        { type: JobType.FILE_IMPORT, status: JobStatus.COMPLETED, metadata: { fileName: 'test1.json', importedCount: 5 } },
        { type: JobType.FILE_IMPORT, status: JobStatus.PENDING, metadata: { fileName: 'test2.json' } },
        { type: JobType.FILE_IMPORT, status: JobStatus.FAILED, metadata: { fileName: 'test3.json', errorMessage: 'Import failed' } },

        // Bulk URL Import jobs
        { type: JobType.BULK_URL_IMPORT, status: JobStatus.COMPLETED, metadata: { totalUrls: 10 } },
        { type: JobType.BULK_URL_IMPORT, status: JobStatus.IN_PROGRESS, metadata: { totalUrls: 20 } },
        { type: JobType.BULK_URL_IMPORT, status: JobStatus.FAILED, metadata: { totalUrls: 5, errorMessage: 'Network error' } },

        // URL Fetch jobs
        { type: JobType.URL_FETCH, status: JobStatus.COMPLETED, metadata: { url: 'https://example.com/1' } },
        { type: JobType.URL_FETCH, status: JobStatus.PENDING, metadata: { url: 'https://example.com/2' } },
        { type: JobType.URL_FETCH, status: JobStatus.IN_PROGRESS, metadata: { url: 'https://example.com/3' } },
      ];

      for (const jobData of testJobs) {
        await db.jobs.add({
          id: crypto.randomUUID(),
          type: jobData.type,
          status: jobData.status,
          metadata: jobData.metadata,
          createdAt: new Date(),
        });
      }

      // Return count for verification
      return await db.jobs.count();
    })()
  `);
}

async function getJobsListCount(page: PageHandle): Promise<number> {
  const count = await page.evaluate(`
    (() => {
      const jobsList = document.getElementById('jobsList');
      if (!jobsList) return 0;

      const loadingDiv = jobsList.querySelector('.loading');
      const emptyDiv = jobsList.querySelector('.empty');

      if (loadingDiv || emptyDiv) return 0;

      return jobsList.querySelectorAll('.job-item').length;
    })()
  `);
  return count as number;
}

async function getJobsListStatus(page: PageHandle): Promise<string> {
  const status = await page.evaluate(`
    (() => {
      const jobsList = document.getElementById('jobsList');
      if (!jobsList) return 'missing';

      if (jobsList.querySelector('.loading')) return 'loading';
      if (jobsList.querySelector('.empty')) return 'empty';

      const jobCount = jobsList.querySelectorAll('.job-item').length;
      return jobCount > 0 ? 'loaded' : 'empty';
    })()
  `);
  return status as string;
}

async function selectFilterValue(page: PageHandle, filterId: string, value: string): Promise<void> {
  await page.select(`#${filterId}`, value);
  // Wait for the filter to be applied and UI to update
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function clickRefreshButton(page: PageHandle): Promise<void> {
  await page.click('#refreshJobsBtn');
  // Wait for refresh to complete
  await new Promise(resolve => setTimeout(resolve, 500));
}

export async function runJobsDashboardTests(adapter: TestAdapter, runner: TestRunner): Promise<void> {
  console.log('\n--- JOBS DASHBOARD FILTERING TESTS ---\n');

  await runner.runTest('Jobs Dashboard - Load page with test data', async () => {
    const page = await adapter.newPage();

    // Set up test jobs in database
    await setupJobsInDatabase(page);

    // Navigate to jobs dashboard
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');
    await page.waitForSelector('#jobTypeFilter');
    await page.waitForSelector('#jobStatusFilter');
    await page.waitForSelector('#refreshJobsBtn');

    // Wait for jobs to load
    await page.waitForFunction(
      `(() => {
        const jobsList = document.getElementById('jobsList');
        return jobsList && !jobsList.querySelector('.loading');
      })()`,
      10000
    );

    // Verify all 9 test jobs are displayed
    const jobCount = await getJobsListCount(page);
    if (jobCount !== 9) {
      throw new Error(`Expected 9 jobs to be displayed, but found ${jobCount}`);
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by job type (FILE_IMPORT)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    // Wait for initial load
    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Select FILE_IMPORT filter
    await selectFilterValue(page, 'jobTypeFilter', 'file_import');

    // Wait for filter to apply
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify only 3 FILE_IMPORT jobs are shown
    const jobCount = await getJobsListCount(page);
    if (jobCount !== 3) {
      throw new Error(`Expected 3 FILE_IMPORT jobs, but found ${jobCount}`);
    }

    // Verify all displayed jobs are FILE_IMPORT type
    const allAreFileImport = await page.evaluate(`
      (() => {
        const jobs = document.querySelectorAll('.job-item .job-type');
        if (jobs.length === 0) return false;
        return Array.from(jobs).every(job => job.textContent?.includes('File Import'));
      })()
    `);

    if (!allAreFileImport) {
      throw new Error('Not all displayed jobs are File Import type');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by job type (BULK_URL_IMPORT)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobTypeFilter', 'bulk_url_import');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 3) {
      throw new Error(`Expected 3 BULK_URL_IMPORT jobs, but found ${jobCount}`);
    }

    const allAreBulkImport = await page.evaluate(`
      (() => {
        const jobs = document.querySelectorAll('.job-item .job-type');
        if (jobs.length === 0) return false;
        return Array.from(jobs).every(job => job.textContent?.includes('Bulk URL Import'));
      })()
    `);

    if (!allAreBulkImport) {
      throw new Error('Not all displayed jobs are Bulk URL Import type');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by job type (URL_FETCH)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobTypeFilter', 'url_fetch');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 3) {
      throw new Error(`Expected 3 URL_FETCH jobs, but found ${jobCount}`);
    }

    const allAreUrlFetch = await page.evaluate(`
      (() => {
        const jobs = document.querySelectorAll('.job-item .job-type');
        if (jobs.length === 0) return false;
        return Array.from(jobs).every(job => job.textContent?.includes('URL Fetch'));
      })()
    `);

    if (!allAreUrlFetch) {
      throw new Error('Not all displayed jobs are URL Fetch type');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by status (COMPLETED)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 3) {
      throw new Error(`Expected 3 COMPLETED jobs, but found ${jobCount}`);
    }

    const allAreCompleted = await page.evaluate(`
      (() => {
        const badges = document.querySelectorAll('.job-status-badge');
        if (badges.length === 0) return false;
        return Array.from(badges).every(badge =>
          badge.textContent?.toUpperCase().includes('COMPLETED')
        );
      })()
    `);

    if (!allAreCompleted) {
      throw new Error('Not all displayed jobs have COMPLETED status');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by status (PENDING)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobStatusFilter', 'pending');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 2) {
      throw new Error(`Expected 2 PENDING jobs, but found ${jobCount}`);
    }

    const allArePending = await page.evaluate(`
      (() => {
        const badges = document.querySelectorAll('.job-status-badge');
        if (badges.length === 0) return false;
        return Array.from(badges).every(badge =>
          badge.textContent?.toUpperCase().includes('PENDING')
        );
      })()
    `);

    if (!allArePending) {
      throw new Error('Not all displayed jobs have PENDING status');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by status (IN_PROGRESS)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobStatusFilter', 'in_progress');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 2) {
      throw new Error(`Expected 2 IN_PROGRESS jobs, but found ${jobCount}`);
    }

    const allAreInProgress = await page.evaluate(`
      (() => {
        const badges = document.querySelectorAll('.job-status-badge');
        if (badges.length === 0) return false;
        return Array.from(badges).every(badge =>
          badge.textContent?.toUpperCase().includes('PROGRESS')
        );
      })()
    `);

    if (!allAreInProgress) {
      throw new Error('Not all displayed jobs have IN_PROGRESS status');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filter by status (FAILED)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    await selectFilterValue(page, 'jobStatusFilter', 'failed');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 2) {
      throw new Error(`Expected 2 FAILED jobs, but found ${jobCount}`);
    }

    const allAreFailed = await page.evaluate(`
      (() => {
        const badges = document.querySelectorAll('.job-status-badge');
        if (badges.length === 0) return false;
        return Array.from(badges).every(badge =>
          badge.textContent?.toUpperCase().includes('FAILED')
        );
      })()
    `);

    if (!allAreFailed) {
      throw new Error('Not all displayed jobs have FAILED status');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Combined filters (type AND status)', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Filter by FILE_IMPORT + COMPLETED
    await selectFilterValue(page, 'jobTypeFilter', 'file_import');
    await selectFilterValue(page, 'jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 300));

    const jobCount = await getJobsListCount(page);
    if (jobCount !== 1) {
      throw new Error(`Expected 1 FILE_IMPORT+COMPLETED job, but found ${jobCount}`);
    }

    const isCorrectJob = await page.evaluate(`
      (() => {
        const jobs = document.querySelectorAll('.job-item');
        if (jobs.length !== 1) return false;

        const job = jobs[0];
        const type = job.querySelector('.job-type')?.textContent || '';
        const status = job.querySelector('.job-status-badge')?.textContent || '';

        return type.includes('File Import') && status.toUpperCase().includes('COMPLETED');
      })()
    `);

    if (!isCorrectJob) {
      throw new Error('Displayed job does not match both filters');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Reset filters to show all jobs', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Apply filters first
    await selectFilterValue(page, 'jobTypeFilter', 'file_import');
    await selectFilterValue(page, 'jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 300));

    let jobCount = await getJobsListCount(page);
    if (jobCount !== 1) {
      throw new Error(`Expected 1 filtered job, but found ${jobCount}`);
    }

    // Reset filters
    await selectFilterValue(page, 'jobTypeFilter', '');
    await selectFilterValue(page, 'jobStatusFilter', '');
    await new Promise(resolve => setTimeout(resolve, 300));

    jobCount = await getJobsListCount(page);
    if (jobCount !== 9) {
      throw new Error(`Expected 9 jobs after reset, but found ${jobCount}`);
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Refresh button reloads job list', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    const initialCount = await getJobsListCount(page);
    if (initialCount !== 9) {
      throw new Error(`Expected 9 initial jobs, but found ${initialCount}`);
    }

    // Add a new job via the database
    await page.evaluate(`
      (async () => {
        const { db, JobType, JobStatus } = await import('/src/db/schema.ts');
        await db.jobs.add({
          id: crypto.randomUUID(),
          type: JobType.URL_FETCH,
          status: JobStatus.COMPLETED,
          metadata: { url: 'https://example.com/refresh-test' },
          createdAt: new Date(),
        });
      })()
    `);

    // Click refresh button
    await clickRefreshButton(page);

    // Wait for refresh to complete
    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Verify the new job appears
    const newCount = await getJobsListCount(page);
    if (newCount !== 10) {
      throw new Error(`Expected 10 jobs after refresh, but found ${newCount}`);
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Filters persist after refresh', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Apply filters
    await selectFilterValue(page, 'jobTypeFilter', 'bulk_url_import');
    await selectFilterValue(page, 'jobStatusFilter', 'completed');
    await new Promise(resolve => setTimeout(resolve, 300));

    const beforeRefresh = await getJobsListCount(page);

    // Click refresh
    await clickRefreshButton(page);
    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Verify filters are still applied
    const afterRefresh = await getJobsListCount(page);
    if (beforeRefresh !== afterRefresh) {
      throw new Error(`Job count changed after refresh: ${beforeRefresh} -> ${afterRefresh}`);
    }

    // Verify filter values are still set
    const typeValue = await page.evaluate(`document.getElementById('jobTypeFilter').value`);
    const statusValue = await page.evaluate(`document.getElementById('jobStatusFilter').value`);

    if (typeValue !== 'bulk_url_import' || statusValue !== 'completed') {
      throw new Error('Filter values were reset after refresh');
    }

    await page.close();
  });

  await runner.runTest('Jobs Dashboard - Empty state when no jobs match filters', async () => {
    const page = await adapter.newPage();
    await page.goto(adapter.getPageUrl('jobs'));
    await page.waitForSelector('#jobsList');

    await page.waitForFunction(
      `document.getElementById('jobsList') && !document.getElementById('jobsList').querySelector('.loading')`,
      10000
    );

    // Apply a filter combination that yields no results
    // We know we have no CANCELLED jobs in our test data
    await selectFilterValue(page, 'jobStatusFilter', 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify empty state is shown
    const status = await getJobsListStatus(page);
    if (status !== 'empty') {
      throw new Error(`Expected empty state, but got: ${status}`);
    }

    const emptyMessage = await page.evaluate(`
      document.getElementById('jobsList')?.querySelector('.empty')?.textContent || ''
    `);

    if (!emptyMessage.toLowerCase().includes('no jobs')) {
      throw new Error('Empty state message not displayed correctly');
    }

    await page.close();
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Jobs Dashboard E2E Tests (Chrome Extension)');
  console.log('='.repeat(60));
  console.log(`API Key: ${process.env.OPENAI_API_KEY ? 'Provided' : 'Not provided'}`);
  console.log('='.repeat(60));

  const adapter = new ChromeAdapter();
  const runner = new TestRunner();

  try {
    await adapter.setup();

    await runJobsDashboardTests(adapter, runner);

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

  console.log('\n✓ All Jobs Dashboard E2E tests passed!');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
