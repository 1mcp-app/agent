import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ADMIN_BUILD_DIR = path.join(process.cwd(), 'build', 'admin');
const PACK_DESTINATION = path.join(process.cwd(), '.tmp-test', 'admin-spa-package');
const TYPECHECK_PROBE = path.join(process.cwd(), 'web', 'admin', 'src', '__node-type-probe.ts');
const LEGACY_ADMIN_CONSOLE_HTML_BUILD = path.join(
  process.cwd(),
  'build',
  'transport',
  'http',
  'routes',
  'adminConsoleHtml.js',
);

function run(command: string, args: string[], cwd = process.cwd()): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });
}

function createIsolatedDockerLayout(): { rootDir: string; configDir: string } {
  const rootDir = mkdtempSync(path.join(tmpdir(), '1mcp-admin-docker-layout-'));
  const configDir = path.join(rootDir, 'config');

  try {
    cpSync(path.join(process.cwd(), 'build'), rootDir, { recursive: true });
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      cpSync(path.join(process.cwd(), file), path.join(rootDir, file));
    }
    run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--prod'], rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    return { rootDir, configDir };
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true });
    throw error;
  }
}

function runExpectFailure(command: string, args: string[]): string {
  try {
    run(command, args);
    throw new Error(`${command} ${args.join(' ')} was expected to fail`);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return `${failure.stdout ?? ''}\n${failure.stderr ?? ''}\n${failure.message ?? ''}`;
  }
}

function findBuiltEntryAsset(extension: string): string {
  const assetsDir = path.join(ADMIN_BUILD_DIR, 'assets');
  return readdirSync(assetsDir).find((name) => name.startsWith('admin-console-') && name.endsWith(extension)) ?? '';
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a local port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(url: string, output: () => string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The runtime may still be initializing.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Flattened Docker layout did not start: ${output()}`);
}

async function stopProcess(process: ReturnType<typeof spawn>): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    process.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill('SIGTERM');
  });
}

describe('admin SPA package build', () => {
  afterEach(() => {
    rmSync(TYPECHECK_PROBE, { force: true });
  });

  it('keeps browser source free of Node-only globals', () => {
    writeFileSync(TYPECHECK_PROBE, 'export const leaked = process.env.NODE_ENV;\n');

    const typecheckOutput = runExpectFailure('pnpm', [
      'exec',
      'tsc',
      '--noEmit',
      '--project',
      'web/admin/tsconfig.json',
    ]);
    const lintOutput = runExpectFailure('pnpm', ['exec', 'eslint', TYPECHECK_PROBE]);

    expect(typecheckOutput).toContain("Cannot find name 'process'");
    expect(lintOutput).toContain("'process' is not defined");
  });

  it('packs the prebuilt admin console SPA with external hashed assets', () => {
    rmSync(PACK_DESTINATION, { recursive: true, force: true });
    mkdirSync(PACK_DESTINATION, { recursive: true });

    const indexPath = path.join(ADMIN_BUILD_DIR, 'index.html');
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(LEGACY_ADMIN_CONSOLE_HTML_BUILD)).toBe(false);

    const indexHtml = readFileSync(indexPath, 'utf8');
    const jsAsset = findBuiltEntryAsset('.js');
    const cssAsset = findBuiltEntryAsset('.css');

    expect(jsAsset).toMatch(/^admin-console-[A-Za-z0-9_-]+\.js$/);
    expect(cssAsset).toMatch(/^admin-console-[A-Za-z0-9_-]+\.css$/);
    expect(existsSync(path.join(ADMIN_BUILD_DIR, 'favicon.svg'))).toBe(true);
    expect(indexHtml).toContain(`/admin/assets/${jsAsset}`);
    expect(indexHtml).toContain(`/admin/assets/${cssAsset}`);
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(indexHtml).not.toMatch(/<style[\s>]/i);

    const packStdout = run('pnpm', ['pack', '--json', '--pack-destination', PACK_DESTINATION]);
    const packOutput = JSON.parse(packStdout.slice(packStdout.indexOf('{'))) as {
      filename: string;
    };
    const tarballPath = packOutput.filename;
    expect(tarballPath).toBeTruthy();

    const tarballListing = run('tar', ['-tzf', tarballPath]);
    expect(tarballListing).toContain('package/build/admin/index.html');
    expect(tarballListing).toContain(`package/build/admin/assets/${jsAsset}`);
    expect(tarballListing).toContain(`package/build/admin/assets/${cssAsset}`);
    expect(tarballListing).toContain('package/build/admin/favicon.svg');
    expect(tarballListing).not.toContain('package/build/.tmp/');
    expect(tarballListing).not.toContain('package/build/transport/http/routes/adminConsoleHtml.js');
  }, 120000);

  it('starts the flattened production Docker layout through its default command and serves Admin Console assets', async () => {
    const { rootDir, configDir } = createIsolatedDockerLayout();
    const port = await getFreePort();
    let output = '';
    const runtime = spawn(process.execPath, ['index.js'], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ONE_MCP_LOG_LEVEL: 'error',
        ONE_MCP_TRANSPORT: 'http',
        ONE_MCP_HOST: '127.0.0.1',
        ONE_MCP_PORT: String(port),
        ONE_MCP_EXTERNAL_URL: `http://127.0.0.1:${port}`,
        ONE_MCP_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runtime.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    runtime.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServer(`${baseUrl}/health/ready`, () => output);

      const adminHtml = await (await fetch(`${baseUrl}/admin`)).text();
      const jsAsset = findBuiltEntryAsset('.js');
      const cssAsset = findBuiltEntryAsset('.css');
      expect(adminHtml).toContain(`/admin/assets/${jsAsset}`);
      expect(adminHtml).toContain(`/admin/assets/${cssAsset}`);
      expect((await fetch(`${baseUrl}/admin/assets/${jsAsset}`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/admin/assets/${cssAsset}`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/admin/favicon.svg`)).status).toBe(200);
    } finally {
      await stopProcess(runtime);
      rmSync(rootDir, { recursive: true, force: true });
    }
  }, 120000);
});
