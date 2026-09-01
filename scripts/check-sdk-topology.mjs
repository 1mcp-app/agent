#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildSdkTopology,
  formatTopologyDifferences,
  SNAPSHOT_PATH,
  topologyDifferences,
} from './sdk-boundary/topology.mjs';

const root = process.cwd();
const snapshotPath = path.join(root, SNAPSHOT_PATH);
const actual = await buildSdkTopology(root);

if (process.argv.includes('--write')) {
  await writeFile(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Wrote ${SNAPSHOT_PATH}`);
  process.exit(0);
}

const expected = JSON.parse(await readFile(snapshotPath, 'utf8'));
const differences = topologyDifferences(expected, actual);
if (differences.length > 0) {
  console.error(`SDK dependency topology differs from ${SNAPSHOT_PATH}:\n${formatTopologyDifferences(differences)}`);
  console.error(
    'Run pnpm install, inspect the dependency change, then update with: pnpm check:sdk-topology -- --write',
  );
  process.exit(1);
}

console.log(`SDK dependency topology matches ${SNAPSHOT_PATH}`);
