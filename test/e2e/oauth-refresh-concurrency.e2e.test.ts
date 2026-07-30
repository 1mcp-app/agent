import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';

import { afterEach, describe, expect, it } from 'vitest';

const CLIENT: OAuthClientInformationFull = {
  client_id: 'cross-process-client',
  redirect_uris: ['http://127.0.0.1:3000/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};
const RESOURCE = 'https://resource.example/mcp';
const RUNTIME_SCOPE_ID = 'cross-process-runtime-scope';
const WORKER_PATH = fileURLToPath(new URL('./fixtures/oauth-refresh-worker.mjs', import.meta.url));

describe('refresh token family cross-process persistence', () => {
  let tempDir: string | undefined;
  const children = new Set<ReturnType<typeof spawn>>();

  afterEach(async () => {
    const activeChildren = [...children].filter((child) => child.exitCode === null && child.signalCode === null);
    for (const child of activeChildren) {
      child.kill('SIGKILL');
    }
    await Promise.all(activeChildren.map(waitForExit));
    children.clear();

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows exactly one process to commit a refresh-token rotation', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-refresh-process-'));
    const provider = new SDKOAuthServerProvider(tempDir, RUNTIME_SCOPE_ID);
    const initial = await (async () => {
      try {
        const code = provider.oauthStorage.authCodeRepository.create(
          CLIENT.client_id,
          CLIENT.redirect_uris[0],
          RESOURCE,
          ['tag:alpha'],
          60_000,
          'challenge',
        );
        return await provider.exchangeAuthorizationCode(
          CLIENT,
          code,
          undefined,
          CLIENT.redirect_uris[0],
          new URL(RESOURCE),
        );
      } finally {
        provider.shutdown();
      }
    })();

    const firstMarker = path.join(tempDir, 'first.entered');
    const secondMarker = path.join(tempDir, 'second.entered');
    const releasePath = path.join(tempDir, 'release-first');
    const first = runWorker(tempDir, initial.refresh_token!, firstMarker, children, releasePath);
    await waitForFile(firstMarker);

    const second = runWorker(tempDir, initial.refresh_token!, secondMarker, children);
    await second.started;
    expect(fs.existsSync(secondMarker)).toBe(false);

    fs.writeFileSync(releasePath, 'release');
    const results = await Promise.all([first.result, second.result]);
    expect(results.map((result) => result.status).sort()).toEqual(['replay', 'rotated']);
  }, 20_000);
});

function runWorker(
  storageDir: string,
  refreshToken: string,
  markerPath: string,
  children: Set<ReturnType<typeof spawn>>,
  releasePath?: string,
): { started: Promise<void>; result: Promise<{ status: string }> } {
  const startedPath = `${markerPath}.started`;
  const child = spawn(
    process.execPath,
    [
      WORKER_PATH,
      storageDir,
      RUNTIME_SCOPE_ID,
      refreshToken,
      CLIENT.client_id,
      startedPath,
      markerPath,
      releasePath ?? '',
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.add(child);

  const result = new Promise<{ status: string }>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      const line = stdout.split('\n').find((candidate) => candidate.startsWith('RESULT '));
      if (!line) {
        reject(new Error(`Refresh worker exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(line.slice('RESULT '.length)) as { status: string });
    });
  });

  return { started: waitForFile(startedPath), result };
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await delay(20);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
