import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });
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

function findBuiltAsset(extension: string): string {
  const assetsDir = path.join(ADMIN_BUILD_DIR, 'assets');
  return readdirSync(assetsDir).find((name) => name.endsWith(extension)) ?? '';
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
    const jsAsset = findBuiltAsset('.js');
    const cssAsset = findBuiltAsset('.css');

    expect(jsAsset).toMatch(/^admin-console-[A-Za-z0-9_-]+\.js$/);
    expect(cssAsset).toMatch(/^admin-console-[A-Za-z0-9_-]+\.css$/);
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
    expect(tarballListing).not.toContain('package/build/.tmp/');
    expect(tarballListing).not.toContain('package/build/transport/http/routes/adminConsoleHtml.js');
  }, 120000);
});
