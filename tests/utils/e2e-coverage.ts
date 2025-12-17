import type { Page, CoverageEntry } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCoverageMap, CoverageMapData } from 'istanbul-lib-coverage';
import v8ToIstanbul from 'v8-to-istanbul';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const COVERAGE_DIR = path.join(PROJECT_ROOT, 'coverage-e2e');

const collectedCoverage: CoverageEntry[] = [];

export async function startCoverage(page: Page): Promise<void> {
  try {
    await page.coverage.startJSCoverage({
      resetOnNavigation: false,
      includeRawScriptCoverage: true,
    });
  } catch (error) {
    console.warn('[E2E Coverage] Failed to start coverage:', error);
  }
}

export async function stopCoverage(page: Page): Promise<CoverageEntry[]> {
  try {
    const coverage = await page.coverage.stopJSCoverage();

    const filteredCoverage = coverage.filter(entry => {
      const url = entry.url;
      return (
        url.includes('chrome-extension://') ||
        url.includes('/src/') ||
        url.includes('/dist-chrome/') ||
        url.includes('/dist-firefox/') ||
        url.includes('/dist-web/')
      );
    });

    collectedCoverage.push(...filteredCoverage);
    return filteredCoverage;
  } catch (error) {
    console.warn('[E2E Coverage] Failed to stop coverage:', error);
    return [];
  }
}

async function convertToIstanbul(entries: CoverageEntry[]): Promise<CoverageMapData> {
  const coverageMap = createCoverageMap({});

  for (const entry of entries) {
    try {
      if (!entry.text) continue;

      let filePath: string;

      if (entry.url.includes('chrome-extension://')) {
        const urlPath = entry.url.replace(/chrome-extension:\/\/[^/]+/, '');
        filePath = path.join(PROJECT_ROOT, 'dist-chrome', urlPath);
      } else if (entry.url.startsWith('file://')) {
        filePath = entry.url.replace('file://', '');
      } else if (entry.url.includes('/dist-')) {
        const distMatch = entry.url.match(/\/dist-(chrome|firefox|web)\/.*/);
        if (distMatch) {
          filePath = path.join(PROJECT_ROOT, distMatch[0]);
        } else {
          continue;
        }
      } else {
        continue;
      }

      if (!fs.existsSync(filePath)) {
        continue;
      }

      // Read source from disk to get sourceMappingURL comment for source map support
      const sourceFromDisk = fs.readFileSync(filePath, 'utf-8');

      const converter = v8ToIstanbul(filePath, 0, {
        source: sourceFromDisk,
      });

      await converter.load();

      converter.applyCoverage(entry.functions || []);

      const istanbulCoverage = converter.toIstanbul();

      for (const [, coverage] of Object.entries(istanbulCoverage)) {
        coverageMap.merge(createCoverageMap({ [coverage.path]: coverage }));
      }
    } catch (error) {
      console.debug('[E2E Coverage] Skipping entry:', entry.url, error);
    }
  }

  return coverageMap.toJSON();
}

export async function writeCoverageReport(): Promise<void> {
  if (collectedCoverage.length === 0) {
    console.log('[E2E Coverage] No coverage data collected');
    return;
  }

  console.log(`[E2E Coverage] Processing ${collectedCoverage.length} coverage entries...`);

  if (!fs.existsSync(COVERAGE_DIR)) {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  }

  try {
    const istanbulCoverage = await convertToIstanbul(collectedCoverage);

    const coveragePath = path.join(COVERAGE_DIR, 'coverage-final.json');
    fs.writeFileSync(coveragePath, JSON.stringify(istanbulCoverage, null, 2));
    console.log(`[E2E Coverage] Written to ${coveragePath}`);

    collectedCoverage.length = 0;
  } catch (error) {
    console.error('[E2E Coverage] Failed to write coverage report:', error);
  }
}

export function getCoverageCount(): number {
  return collectedCoverage.length;
}

export function clearCoverage(): void {
  collectedCoverage.length = 0;
}

export async function mergeCoverageReports(): Promise<void> {
  const unitCoveragePath = path.join(PROJECT_ROOT, 'coverage', 'coverage-final.json');
  const e2eCoveragePath = path.join(COVERAGE_DIR, 'coverage-final.json');
  const mergedCoveragePath = path.join(PROJECT_ROOT, 'coverage-merged', 'coverage-final.json');

  if (!fs.existsSync(unitCoveragePath)) {
    console.warn('[E2E Coverage] Unit test coverage not found');
    return;
  }

  if (!fs.existsSync(e2eCoveragePath)) {
    console.warn('[E2E Coverage] E2E test coverage not found');
    return;
  }

  try {
    const unitCoverage = JSON.parse(fs.readFileSync(unitCoveragePath, 'utf-8'));
    const e2eCoverage = JSON.parse(fs.readFileSync(e2eCoveragePath, 'utf-8'));

    const coverageMap = createCoverageMap(unitCoverage);
    coverageMap.merge(createCoverageMap(e2eCoverage));

    const mergedDir = path.dirname(mergedCoveragePath);
    if (!fs.existsSync(mergedDir)) {
      fs.mkdirSync(mergedDir, { recursive: true });
    }

    fs.writeFileSync(mergedCoveragePath, JSON.stringify(coverageMap.toJSON(), null, 2));
    console.log(`[E2E Coverage] Merged coverage written to ${mergedCoveragePath}`);
  } catch (error) {
    console.error('[E2E Coverage] Failed to merge coverage reports:', error);
  }
}
