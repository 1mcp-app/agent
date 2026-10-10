import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { codeGraphEnvironment } from './codegraphEnvironment.js';

const execute = promisify(execFile);

/** Constant-size metadata validation; source freshness uses the separate
 * Git-native journal cookie barrier, never Node watcher timing or a TTL.
 */
export class CodeGraphFreshness {
  constructor(readonly root: string) {}

  async fingerprint(signal?: AbortSignal): Promise<string> {
    const rootInfo = await stat(this.root);
    const [git, database, wal, configuration] = await Promise.all([
      gitFingerprint(this.root),
      fileStamp(path.join(this.root, '.codegraph', 'codegraph.db')),
      fileStamp(path.join(this.root, '.codegraph', 'codegraph.db-wal')),
      scopeFingerprint(this.root, signal),
    ]);
    return `${rootInfo.dev}:${rootInfo.ino}:${rootInfo.mtimeMs}:${git}:${database}:${wal}:${configuration}`;
  }

  close(): void {}
}

async function gitFingerprint(root: string): Promise<string> {
  let gitDir = path.join(root, '.git');
  try {
    const gitInfo = await stat(gitDir);
    if (gitInfo.isFile()) {
      const metadata = await readFile(gitDir, 'utf8');
      if (!metadata.startsWith('gitdir: ')) throw new Error('Unsupported Git metadata layout.');
      gitDir = path.resolve(root, metadata.slice('gitdir: '.length).trim());
    }
  } catch (error) {
    if (isMissing(error)) return 'no-git';
    throw error;
  }
  const head = await readFile(path.join(gitDir, 'HEAD'), 'utf8');
  let commonDir = gitDir;
  try {
    commonDir = path.resolve(gitDir, (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim());
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const ref = head.startsWith('ref: ') ? head.slice(5).trim() : undefined;
  const paths = [
    path.join(gitDir, 'index'),
    path.join(commonDir, 'packed-refs'),
    path.join(gitDir, 'config'),
    path.join(commonDir, 'config'),
    path.join(commonDir, 'info', 'exclude'),
  ];
  if (ref) {
    paths.push(path.join(gitDir, ref));
    paths.push(path.join(commonDir, ref));
  }
  const stamps = await Promise.all(paths.map(fileStamp));
  return `${head}:${stamps.join(':')}`;
}

async function fileStamp(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } catch (error) {
    if (isMissing(error)) return '-';
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function scopeFingerprint(root: string, signal?: AbortSignal): Promise<string> {
  // Git config/excludes live outside source notification scope. These bounded
  // metadata reads do not enumerate source or run git status/fsmonitor hooks.
  const { stdout } = await execute('git', ['-C', root, 'config', '--null', '--list'], {
    env: codeGraphEnvironment(),
    signal,
    timeout: 2_000,
    maxBuffer: 1_048_576,
  });
  const environment = codeGraphEnvironment();
  const userConfig =
    environment.XDG_CONFIG_HOME ?? (environment.HOME ? path.join(environment.HOME, '.config') : undefined);
  let excludes = userConfig ? await fileStamp(path.join(userConfig, 'git', 'ignore')) : '-';
  const entries = stdout.split('\0');
  for (const entry of entries) {
    const newline = entry.indexOf('\n');
    if (entry.slice(0, newline).toLowerCase() === 'core.excludesfile') {
      const value = entry.slice(newline + 1);
      // --path resolves ~ and relative Git config paths consistently.
      const resolved = await execute('git', ['-C', root, 'config', '--path', '--get', 'core.excludesFile'], {
        env: codeGraphEnvironment(),
        signal,
        timeout: 2_000,
      });
      excludes = await fileStamp(path.resolve(root, resolved.stdout.trim() || value));
    }
  }
  const stamps = await Promise.all(
    ['codegraph.json', '.gitignore', '.codegraph/config.json'].map((file) => fileStamp(path.join(root, file))),
  );
  return `${createHash('sha256').update(stdout).digest('hex')}:${excludes}:${stamps.join(':')}`;
}
