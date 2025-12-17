#!/usr/bin/env npx tsx
/**
 * Coverage Merge Script
 *
 * Merges coverage reports from unit tests and E2E tests into a single report.
 *
 * Usage:
 *   npx tsx scripts/merge-coverage.ts
 *
 * Prerequisites:
 *   1. Run unit tests with coverage: npm run test:unit:coverage
 *   2. Run E2E tests with coverage: npm run test:e2e:chrome:coverage (if implemented)
 *
 * Output:
 *   - coverage-merged/coverage-final.json - Combined coverage data
 *   - coverage-merged/lcov.info - LCOV format for CI/CD tools
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

type CoverageMapData = Record<string, unknown>;
const createCoverageMap = libCoverage.createCoverageMap;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

interface CoverageConfig {
  name: string;
  path: string;
}

const COVERAGE_SOURCES: CoverageConfig[] = [
  { name: 'unit', path: path.join(PROJECT_ROOT, 'coverage', 'coverage-final.json') },
  { name: 'e2e', path: path.join(PROJECT_ROOT, 'coverage-e2e', 'coverage-final.json') },
];

const OUTPUT_DIR = path.join(PROJECT_ROOT, 'coverage-merged');

async function mergeCoverage(): Promise<void> {
  console.log('🔄 Merging coverage reports...\n');

  const coverageMap = createCoverageMap({});
  let sourcesFound = 0;

  for (const source of COVERAGE_SOURCES) {
    if (fs.existsSync(source.path)) {
      console.log(`  ✓ Found ${source.name} coverage: ${source.path}`);
      try {
        const data = JSON.parse(fs.readFileSync(source.path, 'utf-8')) as CoverageMapData;
        coverageMap.merge(createCoverageMap(data));
        sourcesFound++;
      } catch (error) {
        console.warn(`  ⚠ Failed to parse ${source.name} coverage:`, error);
      }
    } else {
      console.log(`  ○ ${source.name} coverage not found: ${source.path}`);
    }
  }

  if (sourcesFound === 0) {
    console.error('\n❌ No coverage data found. Run tests with coverage first:');
    console.error('   npm run test:unit:coverage');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write merged coverage JSON
  const mergedJsonPath = path.join(OUTPUT_DIR, 'coverage-final.json');
  fs.writeFileSync(mergedJsonPath, JSON.stringify(coverageMap.toJSON(), null, 2));
  console.log(`\n📄 Merged coverage written to: ${mergedJsonPath}`);

  // Generate reports using istanbul
  try {
    const context = libReport.createContext({
      dir: OUTPUT_DIR,
      defaultSummarizer: 'nested',
      coverageMap,
    });

    // Generate text report for console
    const textReport = reports.create('text');
    console.log('\n📊 Coverage Summary:\n');
    textReport.execute(context);

    // Generate LCOV for CI/CD
    const lcovReport = reports.create('lcov');
    lcovReport.execute(context);
    console.log(`\n📄 LCOV report written to: ${path.join(OUTPUT_DIR, 'lcov.info')}`);

    // Generate HTML report
    const htmlReport = reports.create('html');
    htmlReport.execute(context);
    console.log(`📄 HTML report written to: ${path.join(OUTPUT_DIR, 'index.html')}`);
  } catch (error) {
    console.warn('⚠ Could not generate additional reports:', error);
  }

  console.log('\n✅ Coverage merge complete!');
}

mergeCoverage().catch(console.error);
