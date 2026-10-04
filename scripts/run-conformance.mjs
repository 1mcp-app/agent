import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConformancePreparation } from './conformance-preparation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let mode = 'baseline';
const forwarded = [];

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--mode') {
    mode = args[index + 1];
    index += 1;
  } else if (argument.startsWith('--mode=')) {
    mode = argument.slice('--mode='.length);
  } else if (argument !== '--') {
    forwarded.push(argument);
  }
}

if (!['baseline', 'gate'].includes(mode)) {
  process.stderr.write('Conformance mode must be baseline or gate.\n');
  process.exit(2);
}

const outputDirectory = path.join(root, '.tmp', 'conformance');
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(path.join(outputDirectory, 'home'), { recursive: true, mode: 0o700 });

const pathValue = process.env.PATH;
if (!pathValue) {
  process.stderr.write('Conformance execution requires PATH.\n');
  process.exit(2);
}

const environment = {
  PATH: pathValue,
  HOME: path.join(outputDirectory, 'home'),
  TMPDIR: path.join(outputDirectory, 'tmp'),
  TEMP: path.join(outputDirectory, 'tmp'),
  TMP: path.join(outputDirectory, 'tmp'),
  NO_PROXY: '127.0.0.1,localhost,::1',
  CI: process.env.CI === 'true' ? 'true' : 'false',
  NODE_ENV: 'test',
  ONE_MCP_CONFORMANCE_MODE: mode,
  ONE_MCP_CONFORMANCE_OUTPUT_DIR: outputDirectory,
  ONE_MCP_RUN_CONFORMANCE_INTEGRATION: 'true',
  UV_CACHE_DIR: path.join(outputDirectory, 'uv-cache'),
};
mkdirSync(environment.TMPDIR, { recursive: true, mode: 0o700 });

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, env: environment, stdio: 'inherit' });
  if (result.error) return 1;
  return result.status ?? 1;
}

async function waitForStableCleanSource() {
  const deadline = Date.now() + 10_000;
  let consecutiveCleanChecks = 0;
  while (Date.now() < deadline) {
    const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
    });
    if (status.error || status.status !== 0) return false;
    consecutiveCleanChecks = status.stdout === '' ? consecutiveCleanChecks + 1 : 0;
    if (consecutiveCleanChecks === 5) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return false;
}

const preparationStatuses = await runConformancePreparation([
  // Preserve the build's ordinary environment; protocol fixtures remain sanitized.
  { name: 'build', command: 'pnpm', args: ['build'], cwd: root, env: process.env },
  {
    name: 'TypeScript fixtures',
    command: 'pnpm',
    args: ['check'],
    cwd: path.join(root, 'test', 'conformance', 'fixtures', 'typescript'),
    env: environment,
  },
  {
    name: 'Python fixtures',
    command: 'uv',
    args: ['run', '--frozen', 'pytest', '-q'],
    cwd: path.join(root, 'test', 'conformance', 'fixtures', 'python'),
    env: environment,
  },
]);
const preparationFailure = preparationStatuses.find((status) => status !== 0);
if (preparationFailure !== undefined) process.exit(preparationFailure);

const preparationTestStatus = run(process.execPath, ['--test', 'test/conformance/runner/preparation.test.mjs']);
if (preparationTestStatus !== 0) process.exit(preparationTestStatus);

const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const transportStatus = run(process.execPath, [
  vitest,
  'run',
  '--config',
  'vitest.conformance-transports.config.ts',
  ...forwarded,
]);
if (transportStatus !== 0) process.exit(transportStatus);

const conformanceChecksStatus = run(process.execPath, [
  vitest,
  'run',
  '--config',
  'vitest.conformance.config.ts',
  '--exclude',
  'test/conformance/foundation/foundation.integration.test.ts',
  ...forwarded,
]);
if (conformanceChecksStatus !== 0) process.exit(conformanceChecksStatus);

if (!(await waitForStableCleanSource())) {
  process.stderr.write('Conformance exact-source stage requires a stable clean worktree.\n');
  process.exit(1);
}

const foundationStatus = run(process.execPath, [
  vitest,
  'run',
  '--config',
  'vitest.conformance.config.ts',
  'test/conformance/foundation/foundation.integration.test.ts',
]);
if (foundationStatus !== 0) process.exit(foundationStatus);

if (!existsSync(path.join(outputDirectory, 'conformance-baseline.json'))) {
  process.stderr.write('Conformance run completed without a finalized baseline artifact.\n');
  process.exit(1);
}
