import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const cliPath = path.join(process.cwd(), 'build', 'index.js');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createScope(ownerEntries: Record<string, string> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-ownership-e2e-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  if (ownerEntries !== null) {
    fs.mkdirSync(path.join(dir, 'runtime.owner'));
    for (const [name, content] of Object.entries(ownerEntries)) {
      fs.writeFileSync(path.join(dir, 'runtime.owner', name), content);
    }
  }
  return dir;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnServe(dir: string, port: number) {
  return spawn(
    process.execPath,
    [
      cliPath,
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config-dir',
      dir,
      '--log-level',
      'info',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition was not met before timeout');
}

async function stop(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readOwner(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'runtime.owner', 'owner.json'), 'utf8'));
}

describe('runtime ownership recovery', () => {
  it('starts when a recorded owner PID is provably absent', async () => {
    const dir = createScope({
      'owner.json': JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-owner',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    });
    const child = spawnServe(dir, await freePort());
    try {
      await waitFor(() => fs.existsSync(path.join(dir, 'server.pid')), 30_000);
      const owner = readOwner(dir);
      expect(owner.pid).toBe(child.pid);
      expect(owner.claimId).not.toBe('dead-owner');
    } finally {
      await stop(child);
    }
  }, 60_000);

  it('starts on an empty canonical ownership directory', async () => {
    const dir = createScope({});
    const child = spawnServe(dir, await freePort());
    try {
      await waitFor(() => fs.existsSync(path.join(dir, 'server.pid')), 30_000);
      expect(readOwner(dir).pid).toBe(child.pid);
    } finally {
      await stop(child);
    }
  }, 60_000);

  it('fails closed and names unknown ownership entries', async () => {
    const dir = createScope({ 'owner.json.bak': '{}' });
    const child = spawnServe(dir, await freePort());
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 30_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('owner.json.bak');
    expect(fs.existsSync(path.join(dir, 'runtime.owner', 'owner.json.bak'))).toBe(true);
  }, 60_000);
});
