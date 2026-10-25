import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'test/conformance/fixtures');
const steps = [
  ['pnpm', ['build'], root],
  ['pnpm', ['check'], path.join(fixtureRoot, 'typescript')],
  ['uv', ['run', '--frozen', 'pytest', '-q'], path.join(fixtureRoot, 'python')],
  [
    process.execPath,
    [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.protocol.config.ts',
      ...process.argv.slice(2).filter((arg) => arg !== '--'),
    ],
    root,
  ],
];
for (const [command, args, cwd] of steps) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CODEX_SESSION_ID: '', CODEX_THREAD_ID: '', NODE_ENV: 'test' },
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
