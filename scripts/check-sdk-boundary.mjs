#!/usr/bin/env node
import { checkSdkImportBoundary, formatImportViolations } from './sdk-boundary/import-policy.mjs';

const violations = await checkSdkImportBoundary(process.cwd());
if (violations.length > 0) {
  console.error(`Legacy SDK imports found outside src/sdk/legacy/:\n${formatImportViolations(violations)}`);
  process.exit(1);
}

console.log('Legacy SDK imports are contained in src/sdk/legacy/');
