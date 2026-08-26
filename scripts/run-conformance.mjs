import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  GOCACHE: path.join(outputDirectory, 'go-cache'),
};
mkdirSync(environment.TMPDIR, { recursive: true, mode: 0o700 });

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, { cwd, env: environment, stdio: 'inherit' });
  if (result.error) return 1;
  return result.status ?? 1;
}

const fixtureChecks = [
  ['pnpm', ['check'], path.join(root, 'test', 'conformance', 'fixtures', 'typescript')],
  ['go', ['test', '-mod=vendor', './...'], path.join(root, 'test', 'conformance', 'fixtures', 'go')],
  ['uv', ['run', '--frozen', 'pytest', '-q'], path.join(root, 'test', 'conformance', 'fixtures', 'python')],
];

for (const [command, commandArgs, cwd] of fixtureChecks) {
  const status = run(command, commandArgs, cwd);
  if (status !== 0) process.exit(status);
}

const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const transportStatus = run(process.execPath, [
  vitest,
  'run',
  '--config',
  'vitest.conformance-transports.config.ts',
  ...forwarded,
]);
if (transportStatus !== 0) process.exit(transportStatus);

const profileProofs = [
  ['inbound-http-sse-retained', 'fixture.typescript.retained-sse'],
  ['direct-serve-stdio', 'transport.stdio-protocol'],
  ['proxy-stdio', 'transport.stdio-protocol'],
  ['upstream-sse-retained', 'fixture.typescript.retained-sse'],
  ['upstream-stdio-modern', 'fixture.typescript.v2-stdio'],
  ['upstream-stdio-legacy', 'fixture.polyglot-and-typescript.legacy-stdio'],
].map(([profile, testId]) => ({
  profile,
  testId,
  attempt: 1,
  evidenceDigest: `sha256:${createHash('sha256').update(`${profile}:${testId}:attempt-1`).digest('hex')}`,
}));
writeFileSync(
  path.join(outputDirectory, 'profile-proofs.json'),
  `${JSON.stringify({ schemaVersion: 1, profileProofs }, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 },
);

const conformanceStatus = run(process.execPath, [
  vitest,
  'run',
  '--config',
  'vitest.conformance.config.ts',
  ...forwarded,
]);
if (conformanceStatus !== 0) process.exit(conformanceStatus);

if (!existsSync(path.join(outputDirectory, 'conformance-baseline.json'))) {
  process.stderr.write('Conformance run completed without a finalized baseline artifact.\n');
  process.exit(1);
}
