/**
 * E2E Coverage Collection Utility
 *
 * Collects V8 coverage from Puppeteer-based E2E tests and converts it to
 * Istanbul format for merging with unit test coverage.
 *
 * Usage:
 *   1. Call startCoverage(page) before navigating to test pages
 *   2. Call stopCoverage(page) after test completion
 *   3. Call writeCoverageReport() to save the merged coverage
 */

import type { Page, CoverageEntry } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCoverageMap, CoverageMapData } from 'istanbul-lib-coverage';
import v8ToIstanbul from 'v8-to-istanbul';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const COVERAGE_DIR = path.join(PROJECT_ROOT, 'coverage-e2e');

// Collected coverage entries from all pages
const collectedCoverage: CoverageEntry[] = [];

/**
 * Start collecting JavaScript coverage on a page.
 * Should be called before navigating to test pages.
 */
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

/**
 * Stop collecting coverage and store the results.
 * Should be called after test completion.
 */
export async function stopCoverage(page: Page): Promise<CoverageEntry[]> {
  try {
    const coverage = await page.coverage.stopJSCoverage();

    // Filter to only include source files from the extension
    const filteredCoverage = coverage.filter(entry => {
      const url = entry.url;
      // Include only extension source files
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

/**
 * Convert V8 coverage entries to Istanbul format.
 */
async function convertToIstanbul(entries: CoverageEntry[]): Promise<CoverageMapData> {
  const coverageMap = createCoverageMap({});

  for (const entry of entries) {
    try {
      // Skip entries without source
      if (!entry.text) continue;

      // Determine the file path
      let filePath: string;

      if (entry.url.includes('chrome-extension://')) {
        // Extract path from chrome-extension URL
        const urlPath = entry.url.replace(/chrome-extension:\/\/[^/]+/, '');
        filePath = path.join(PROJECT_ROOT, 'dist-chrome', urlPath);
      } else if (entry.url.startsWith('file://')) {
        filePath = entry.url.replace('file://', '');
      } else if (entry.url.includes('/dist-')) {
        // Handle dist directory URLs
        const distMatch = entry.url.match(/\/dist-(chrome|firefox|web)\/.*/);
        if (distMatch) {
          filePath = path.join(PROJECT_ROOT, distMatch[0]);
        } else {
          continue;
        }
      } else {
        continue;
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        continue;
      }

      // Convert using v8-to-istanbul
      const converter = v8ToIstanbul(filePath, 0, {
        source: entry.text,
      });

      await converter.load();

      // Apply the function coverage
      converter.applyCoverage(entry.functions || []);

      // Get the Istanbul format
      const istanbulCoverage = converter.toIstanbul();

      // Merge into the coverage map
      for (const [, coverage] of Object.entries(istanbulCoverage)) {
        coverageMap.merge(createCoverageMap({ [coverage.path]: coverage }));
      }
    } catch (error) {
      // Skip files that can't be converted
      console.debug('[E2E Coverage] Skipping entry:', entry.url, error);
    }
  }

  return coverageMap.toJSON();
}

/**
 * Write the collected coverage to files.
 */
export async function writeCoverageReport(): Promise<void> {
  if (collectedCoverage.length === 0) {
    console.log('[E2E Coverage] No coverage data collected');
    return;
  }

  console.log(`[E2E Coverage] Processing ${collectedCoverage.length} coverage entries...`);

  // Ensure coverage directory exists
  if (!fs.existsSync(COVERAGE_DIR)) {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  }

  try {
    // Convert to Istanbul format
    const istanbulCoverage = await convertToIstanbul(collectedCoverage);

    // Write coverage-final.json
    const coveragePath = path.join(COVERAGE_DIR, 'coverage-final.json');
    fs.writeFileSync(coveragePath, JSON.stringify(istanbulCoverage, null, 2));
    console.log(`[E2E Coverage] Written to ${coveragePath}`);

    // Clear collected coverage
    collectedCoverage.length = 0;
  } catch (error) {
    console.error('[E2E Coverage] Failed to write coverage report:', error);
  }
}

/**
 * Get the collected coverage entries count.
 */
export function getCoverageCount(): number {
  return collectedCoverage.length;
}

/**
 * Clear all collected coverage.
 */
export function clearCoverage(): void {
  collectedCoverage.length = 0;
}

/**
 * Merge E2E coverage with unit test coverage.
 * This should be called after both unit tests and E2E tests have run.
 */
export async function mergeCoverageReports(): Promise<void> {
  const unitCoveragePath = path.join(PROJECT_ROOT, 'coverage', 'coverage-final.json');
  const e2eCoveragePath = path.join(COVERAGE_DIR, 'coverage-final.json');
  const mergedCoveragePath = path.join(PROJECT_ROOT, 'coverage-merged', 'coverage-final.json');

  // Check if both coverage files exist
  if (!fs.existsSync(unitCoveragePath)) {
    console.warn('[E2E Coverage] Unit test coverage not found');
    return;
  }

  if (!fs.existsSync(e2eCoveragePath)) {
    console.warn('[E2E Coverage] E2E test coverage not found');
    return;
  }

  try {
    // Load both coverage files
    const unitCoverage = JSON.parse(fs.readFileSync(unitCoveragePath, 'utf-8'));
    const e2eCoverage = JSON.parse(fs.readFileSync(e2eCoveragePath, 'utf-8'));

    // Create coverage map and merge
    const coverageMap = createCoverageMap(unitCoverage);
    coverageMap.merge(createCoverageMap(e2eCoverage));

    // Ensure merged directory exists
    const mergedDir = path.dirname(mergedCoveragePath);
    if (!fs.existsSync(mergedDir)) {
      fs.mkdirSync(mergedDir, { recursive: true });
    }

    // Write merged coverage
    fs.writeFileSync(mergedCoveragePath, JSON.stringify(coverageMap.toJSON(), null, 2));
    console.log(`[E2E Coverage] Merged coverage written to ${mergedCoveragePath}`);
  } catch (error) {
    console.error('[E2E Coverage] Failed to merge coverage reports:', error);
  }
}
