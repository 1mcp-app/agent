import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestProcessEnvironment, isolatedTestEnvironment } from './test-process-environment.mjs';

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
const isolated = isolatedTestEnvironment();
try {
  for (const [command, args, cwd] of steps) {
    const result = spawnSync(command, args, {
      cwd,
      env: createTestProcessEnvironment({ NODE_ENV: 'test' }, isolated.env),
      stdio: 'inherit',
    });
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) {
      process.exitCode = result.status || 1;
      break;
    }
  }
} finally {
  isolated.cleanup();
}
