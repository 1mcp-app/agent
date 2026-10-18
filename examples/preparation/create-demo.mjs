// Creates disposable fixtures only. Does not start 1MCP or install dependencies.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const example = path.dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(path.join(tmpdir(), '1mcp-recipe-demo-')));
for (const name of ['first', 'second']) {
  const checkout = path.join(root, name);
  await mkdir(checkout);
  execFileSync('git', ['init', '-q', checkout]);
  await writeFile(path.join(checkout, 'source.txt'), `${name} checkout source\n`);
  await writeFile(path.join(checkout, 'preparation-release.marker'), 'release');
}
await mkdir(path.join(root, 'config'));
await writeFile(
  path.join(root, 'config', 'mcp.json'),
  JSON.stringify(
    {
      mcpServers: {},
      mcpTemplates: {
        fixture: {
          command: process.execPath,
          args: [path.join(example, 'fixture.mjs'), 'serve', '{{{project.path}}}'],
          cwd: '{{{project.path}}}',
          preparation: {
            adapter: 'configured-command',
            definition: {
              id: 'fixture-source',
              file: path.join(example, 'recipe.json'),
              inputs: { label: 'my local demo' },
            },
            activation: 'setup',
            allowedActions: ['initialize', 'sync'],
          },
        },
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`Disposable demo created at ${root}`);
console.log('Requires installed repository dependencies, Node on PATH, Git, and Linux or macOS.');
console.log(
  `Set DEMO='${root.replaceAll("'", "'\\''")}' in both terminals, then follow the backend preparation guide.`,
);
