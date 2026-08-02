import fs from 'fs';
import os from 'os';
import path from 'path';

import { createRequire } from 'module';
import { list } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { archiveAllBinaries, createArchive } = require('../../scripts/archive.cjs') as {
  archiveAllBinaries: (directory?: string, options?: { format?: string; outputDir?: string }) => Promise<string[]>;
  createArchive: (binaryPath: string, options?: { format?: string; outputDir?: string }) => Promise<string>;
};

const tempRoots: string[] = [];

function createTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-archive-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('archive release artifacts', () => {
  it('creates a non-empty tar archive with archiver v8 constructors', async () => {
    const tempRoot = createTempRoot();
    const binaryPath = path.join(tempRoot, '1mcp-linux-x64');
    fs.writeFileSync(binaryPath, 'release binary');

    const archivePath = await createArchive(binaryPath, { format: 'tar', outputDir: tempRoot });

    expect(path.basename(archivePath)).toBe('1mcp-linux-x64.tar.gz');
    expect(fs.statSync(archivePath).size).toBeGreaterThan(0);

    // 使用 npm tar 包读取归档，避免依赖系统 tar 命令
    const files: string[] = [];

    await list({
      file: archivePath,
      onReadEntry: (entry) => {
        files.push(entry.path);
      },
    });

    expect(files).toEqual(['1mcp-linux-x64']);
  });

  it('fails instead of succeeding with no archived binaries', async () => {
    const tempRoot = createTempRoot();
    fs.writeFileSync(path.join(tempRoot, 'not-a-release-binary'), 'ignored');

    await expect(archiveAllBinaries(tempRoot)).rejects.toThrow('No binaries found to archive.');
  });
});
