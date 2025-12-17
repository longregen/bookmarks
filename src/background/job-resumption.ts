import { resetInterruptedJobs, getBulkImportsToResume } from '../lib/jobs';
import { processBulkFetch } from './fetcher';
import { ensureOffscreenDocument } from '../lib/offscreen';

export async function resumeInterruptedJobs(): Promise<{
  resumedBulkImports: number;
  resetFetchJobs: number;
}> {
  console.log('Checking for interrupted jobs...');

  const { bulkImportsReset, fetchJobsReset } = await resetInterruptedJobs();

  if (bulkImportsReset === 0 && fetchJobsReset === 0) {
    console.log('No interrupted jobs found');
    return { resumedBulkImports: 0, resetFetchJobs: 0 };
  }

  console.log(`Found ${bulkImportsReset} interrupted bulk imports, ${fetchJobsReset} fetch jobs reset`);

  const bulkImportsToResume = await getBulkImportsToResume();

  if (bulkImportsToResume.length > 0) {
    console.log(`Resuming ${bulkImportsToResume.length} bulk import(s)...`);

    if (__IS_CHROME__) {
      await ensureOffscreenDocument();
    }

    for (const parentJob of bulkImportsToResume) {
      const retryCount = parentJob.metadata.retryCount ?? 0;
      const successCount = parentJob.metadata.successCount ?? 0;
      const totalUrls = parentJob.metadata.totalUrls;
      if (totalUrls !== undefined) {
        console.log(`Resuming bulk import: ${parentJob.id} (${successCount}/${totalUrls} complete, retry ${retryCount})`);
      } else {
        console.log(`Resuming bulk import: ${parentJob.id} (retry ${retryCount})`);
      }

      // eslint-disable-next-line @typescript-eslint/require-await
      processBulkFetch(parentJob.id, true).catch(async (error: unknown) => {
        console.error(`Error resuming bulk import ${parentJob.id} (retry ${retryCount}):`, error);
      });
    }
  }

  return {
    resumedBulkImports: bulkImportsToResume.length,
    resetFetchJobs: fetchJobsReset,
  };
}
