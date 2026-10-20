import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after packing and sea:build: node scripts/verify-preparation-skill-package.mjs package.tgz build/bundled.cjs
const [tarball, bundle] = process.argv.slice(2);
if (!tarball || !bundle) throw new Error('Supply the npm tarball and SEA bundle paths');
const repository = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), '1mcp-skill-package-'));
const expected = await import(new URL('../build/commands/cliSetup/preparationSkill.generated.js', import.meta.url));

try {
  execFileSync('tar', ['-xzf', path.resolve(tarball), '-C', root]);
  const packageRoot = path.join(root, 'package');
  // Reuse installed dependencies offline; the extracted package has no skill source tree.
  await symlink(path.join(repository, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
  const bundlePath = path.join(root, 'standalone.cjs');
  await cp(path.resolve(bundle), bundlePath);
  for (const [kind, entry] of [
    ['npm', path.join(packageRoot, 'build/index.js')],
    ['SEA bundle', bundlePath],
  ]) {
    for (const client of ['codex', 'claude']) {
      for (const scope of ['global', 'repo', 'all']) {
        const sandbox = path.join(root, `${kind}-${client}-${scope}`);
        const home = path.join(sandbox, 'home');
        const repo = path.join(sandbox, 'repo');
        const config = path.join(sandbox, 'config');
        await mkdir(repo, { recursive: true });
        await mkdir(config);
        const originalConfig = JSON.stringify({ mcpServers: {} });
        await writeFile(path.join(config, 'mcp.json'), originalConfig);
        const run = () =>
          execFileSync(
            process.execPath,
            [entry, 'cli-setup', `--${client}`, '--scope', scope, '--repo-root', repo, '--config-dir', config],
            {
              cwd: sandbox,
              env: { ...process.env, HOME: home, USERPROFILE: home },
              encoding: 'utf8',
              timeout: 30_000,
            },
          );
        assert.match(run(), /\(installed\)/);
        const destinations = (scope === 'all' ? ['global', 'repo'] : [scope]).map((location) => {
          const base = location === 'global' ? home : repo;
          const directory = location === 'repo' && client === 'codex' ? '.agents' : `.${client}`;
          return path.join(base, directory, 'skills/1mcp-preparation-setup');
        });
        for (const destination of destinations) {
          for (const [relative, content] of Object.entries(expected.preparationSkillFiles)) {
            assert.equal(await readFile(path.join(destination, relative), 'utf8'), content);
          }
        }
        assert.match(run(), /\(unchanged\)/);
        const edited = path.join(destinations[0], 'SKILL.md');
        await writeFile(edited, 'local custom skill\n');
        assert.match(run(), /\(conflict: Locally edited file preserved/);
        assert.equal(await readFile(edited, 'utf8'), 'local custom skill\n');
        assert.equal(await readFile(path.join(config, 'mcp.json'), 'utf8'), originalConfig);
        process.stdout.write(`${kind}: ${client}/${scope} install, repeat, conflict, and config preservation passed\n`);
      }
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
