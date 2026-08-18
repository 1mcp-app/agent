import { chmod, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { OAuthRequiredError } from '@src/core/client/types.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigLoader } from './configLoader.js';
import {
  activateRuntimeScopeEnvironment,
  getRuntimeScopeEnvPath,
  loadRuntimeScopeEnvironment,
  parseRuntimeScopeEnvironment,
  RuntimeScopeEnvError,
  sanitizeRuntimeScopeError,
} from './runtimeScopeEnv.js';

describe('Runtime Scope environment', () => {
  const directories: string[] = [];

  afterEach(async () => {
    activateRuntimeScopeEnvironment({});
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('detaches and redacts secret-bearing spawn errors while preserving safe metadata', () => {
    const secret = 'scope-spawn-secret';
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    const original = Object.assign(new Error(`spawn /bin/${secret} ENOENT`), {
      code: 'ENOENT',
      path: `/bin/${secret}`,
      spawnargs: ['--token', secret],
      details: { url: `https://example.test/${secret}` },
    });
    original.name = 'SpawnError';
    original.stack = `SpawnError: ${secret}\n    at spawn (${secret}:1:1)`;

    const sanitized = sanitizeRuntimeScopeError(original) as Error & {
      code: string;
      path: string;
      spawnargs: string[];
      details: { url: string };
    };

    expect(sanitized).not.toBe(original);
    expect(sanitized.name).toBe('SpawnError');
    expect(sanitized.code).toBe('ENOENT');
    expect(sanitized.path).toBe('/bin/[REDACTED]');
    expect(sanitized.spawnargs).toEqual(['--token', '[REDACTED]']);
    expect(sanitized.details.url).toBe('https://example.test/[REDACTED]');
    expect(`${sanitized.message}\n${sanitized.stack}\n${JSON.stringify(sanitized)}`).not.toContain(secret);
    expect(original.path).toContain(secret);
    expect(sanitized).not.toHaveProperty('cause');
  });

  it('preserves unrelated errors by identity and content', () => {
    activateRuntimeScopeEnvironment({ TOKEN: 'scope-secret' });
    const diagnostic = Object.assign(new TypeError('OAuth session storage is unavailable'), { code: 'EACCES' });

    expect(sanitizeRuntimeScopeError(diagnostic)).toBe(diagnostic);
  });

  it('redacts secret values even when they are short', () => {
    activateRuntimeScopeEnvironment({ FLAG: 'x' });
    const diagnostic = new Error('flag x failed');

    expect(sanitizeRuntimeScopeError(diagnostic).message).toBe('flag [REDACTED] failed');
  });

  it('redacts arbitrary non-enumerable string and symbol data without invoking accessors', () => {
    const secret = 'hidden-diagnostic-secret';
    const symbol = Symbol('hidden');
    const getter = vi.fn(() => secret);
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    const diagnostic = new Error('safe');
    Object.defineProperty(diagnostic, 'detail', { value: secret, enumerable: false, configurable: true });
    Object.defineProperty(diagnostic, symbol, { value: { token: secret }, enumerable: false, configurable: true });
    Object.defineProperty(diagnostic, 'computed', { get: getter, enumerable: false, configurable: true });

    const sanitized = sanitizeRuntimeScopeError(diagnostic) as Error & { detail: string; [symbol]: { token: string } };

    expect(sanitized).not.toBe(diagnostic);
    expect(sanitized.detail).toBe('[REDACTED]');
    expect(sanitized[symbol].token).toBe('[REDACTED]');
    expect(Object.getOwnPropertyDescriptor(sanitized, 'detail')?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(sanitized, symbol)?.enumerable).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('sanitizes cyclic cause, AggregateError errors, and symbol metadata', () => {
    const secret = 'cyclic-diagnostic-secret';
    const diagnosticSymbol = Symbol(`diagnostic-${secret}`);
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    const aggregate = new AggregateError([], 'aggregate failed');
    const nested = new Error('nested failure') as Error & {
      cause?: unknown;
      [diagnosticSymbol]?: { token: string; self?: unknown };
    };
    const metadata: { token: string; self?: unknown } = { token: secret };
    metadata.self = metadata;
    Object.defineProperty(nested, 'cause', { value: aggregate, configurable: true });
    Object.defineProperty(nested, diagnosticSymbol, { value: metadata, enumerable: true, configurable: true });
    Object.defineProperty(aggregate, 'errors', { value: [nested], configurable: true });

    const sanitized = sanitizeRuntimeScopeError(aggregate) as AggregateError;
    const safeNested = sanitized.errors[0] as typeof nested;
    const safeSymbol = Reflect.ownKeys(safeNested).find(
      (key): key is symbol => typeof key === 'symbol' && key.description === 'diagnostic-[REDACTED]',
    )!;
    const safeMetadata = Reflect.get(safeNested, safeSymbol) as { token: string; self?: unknown };

    expect(sanitized).not.toBe(aggregate);
    expect(sanitized).toBeInstanceOf(AggregateError);
    expect(safeNested).not.toBe(nested);
    expect(safeNested.cause).toBe(sanitized);
    expect(safeMetadata.token).toBe('[REDACTED]');
    expect(safeMetadata.self).toBe(safeMetadata);
    expect(safeSymbol).not.toBe(diagnosticSymbol);
    expect(Reflect.ownKeys(safeNested).map(String).join()).not.toContain(secret);
    expect(Object.getOwnPropertyDescriptor(safeNested, safeSymbol)?.enumerable).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });

  it('detaches secret-bearing class instances used as diagnostic causes', () => {
    const secret = 'custom-cause-secret';
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    class CustomCause {
      public detail = secret;
    }
    const cause = new CustomCause();
    const original = new Error('outer failure', { cause });

    const sanitized = sanitizeRuntimeScopeError(original);
    const safeCause = sanitized.cause as { detail: string };

    expect(sanitized).not.toBe(original);
    expect(safeCause).not.toBe(cause);
    expect(safeCause.detail).toBe('[REDACTED]');
    expect(JSON.stringify(safeCause)).not.toContain(secret);
  });

  it('preserves an OAuth client as a live non-enumerable operational reference', () => {
    const secret = 'oauth-client-graph-secret';
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    class OperationalClient {
      public token = secret;
      public close = () => 'closed';
    }
    const client = new OperationalClient();
    const original = new OAuthRequiredError('oauth-server', client as never);

    const sanitized = sanitizeRuntimeScopeError(original) as OAuthRequiredError;

    expect(sanitized).not.toBe(original);
    expect(sanitized).toBeInstanceOf(OAuthRequiredError);
    expect(sanitized.client).toBe(client);
    expect((sanitized.client as never as OperationalClient).close()).toBe('closed');
    expect(Object.getOwnPropertyDescriptor(sanitized, 'client')?.enumerable).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain(secret);
  });

  it('does not preserve client objects on errors that only spoof the OAuth error name', () => {
    const secret = 'spoofed-oauth-secret';
    activateRuntimeScopeEnvironment({ TOKEN: secret });
    class DiagnosticClient {
      public token = secret;
    }
    const client = new DiagnosticClient();
    const original = Object.assign(new Error('spoofed OAuth failure'), { client });
    original.name = 'OAuthRequiredError';

    const sanitized = sanitizeRuntimeScopeError(original) as Error & { client: { token: string } };

    expect(sanitized.client).not.toBe(client);
    expect(sanitized.client.token).toBe('[REDACTED]');
  });

  it('selects the .env beside default, --config-dir, and --config resolved paths', () => {
    expect(getRuntimeScopeEnvPath('/scope/mcp.json')).toBe('/scope/.env');
    expect(getRuntimeScopeEnvPath('/custom/directory/mcp.json')).toBe('/custom/directory/.env');
    expect(getRuntimeScopeEnvPath('/other/location/custom.json')).toBe('/other/location/.env');
  });

  it('accepts a missing file and parses common dotenv syntax', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-env-'));
    directories.push(directory);
    const configPath = path.join(directory, 'mcp.json');

    expect(loadRuntimeScopeEnvironment(configPath)).toEqual({});
    await writeFile(path.join(directory, '.env'), 'PLAIN=value\nexport QUOTED="two words"\nEMPTY=\n');
    expect(loadRuntimeScopeEnvironment(configPath)).toEqual({ PLAIN: 'value', QUOTED: 'two words', EMPTY: '' });
  });

  it('detects create, change, atomic replacement, and deletion', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-env-'));
    directories.push(directory);
    const configPath = path.join(directory, 'mcp.json');
    const envPath = path.join(directory, '.env');
    const loader = new ConfigLoader(configPath);

    expect(loader.checkRuntimeEnvModified()).toBe(false);
    await writeFile(envPath, 'VALUE=created\n');
    expect(loader.checkRuntimeEnvModified()).toBe(true);
    expect(loader.checkRuntimeEnvModified()).toBe(true);
    loader.markRuntimeEnvObserved(loader.captureRuntimeEnvSignature());
    expect(loader.checkRuntimeEnvModified()).toBe(false);
    await writeFile(envPath, 'VALUE=changed-longer\n');
    expect(loader.checkRuntimeEnvModified()).toBe(true);
    loader.markRuntimeEnvObserved(loader.captureRuntimeEnvSignature());
    await writeFile(`${envPath}.next`, 'VALUE=replaced\n');
    await rename(`${envPath}.next`, envPath);
    expect(loader.checkRuntimeEnvModified()).toBe(true);
    loader.markRuntimeEnvObserved(loader.captureRuntimeEnvSignature());
    await unlink(envPath);
    expect(loader.checkRuntimeEnvModified()).toBe(true);
  });

  it('does not acknowledge an atomic replacement that occurred after a successful load', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-env-'));
    directories.push(directory);
    const configPath = path.join(directory, 'mcp.json');
    const envPath = path.join(directory, '.env');
    await writeFile(envPath, 'VALUE=loaded\n');
    const loader = new ConfigLoader(configPath);
    const loadedSignature = loader.captureRuntimeEnvSignature();

    expect(loadRuntimeScopeEnvironment(configPath)).toEqual({ VALUE: 'loaded' });
    await writeFile(envPath + '.next', 'VALUE=unseen\n');
    await rename(envPath + '.next', envPath);
    loader.markRuntimeEnvObserved(loadedSignature);

    expect(loader.checkRuntimeEnvModified()).toBe(true);
  });

  it('does not acknowledge a deletion that occurred after a failed load attempt began', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-env-'));
    directories.push(directory);
    const configPath = path.join(directory, 'mcp.json');
    const envPath = path.join(directory, '.env');
    await writeFile(envPath, 'invalid line\n');
    const loader = new ConfigLoader(configPath);
    const attemptedSignature = loader.captureRuntimeEnvSignature();

    expect(() => loadRuntimeScopeEnvironment(configPath)).toThrow(RuntimeScopeEnvError);
    await unlink(envPath);
    loader.markRuntimeEnvAttempted(attemptedSignature);

    expect(loader.checkRuntimeEnvModified()).toBe(true);
  });

  it('reports malformed input with path and line but never includes file values', () => {
    const filePath = '/scope/.env';
    const secret = 'must-not-appear';

    expect(() => parseRuntimeScopeEnvironment(`GOOD=${secret}\nnot-an-assignment`, filePath)).toThrow(
      new RuntimeScopeEnvError(filePath, 'parse', 2),
    );
    try {
      parseRuntimeScopeEnvironment(`GOOD=${secret}\nnot-an-assignment`, filePath);
    } catch (error) {
      expect(String(error)).toContain(filePath);
      expect(String(error)).not.toContain(secret);
      expect(error).not.toHaveProperty('source');
    }
  });

  it('decodes double-quoted escapes without reinterpreting escaped backslashes', () => {
    const parsed = parseRuntimeScopeEnvironment(
      'NEWLINE="first\\nsecond"\nLITERAL="first\\\\nsecond"\nQUOTED="say \\"hello\\""\nTAB="left\\tright"\nBACKSLASH="left\\\\right"',
      '/scope/.env',
    );

    expect(parsed).toEqual({
      NEWLINE: 'first\nsecond',
      LITERAL: 'first\\nsecond',
      QUOTED: 'say "hello"',
      TAB: 'left\tright',
      BACKSLASH: 'left\\right',
    });
  });

  it.skipIf(process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'reports unreadable files without exposing contents',
    async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'runtime-env-'));
    directories.push(directory);
    const envPath = path.join(directory, '.env');
    await writeFile(envPath, 'SECRET=must-not-appear\n');
    await chmod(envPath, 0o000);

    try {
      expect(() => loadRuntimeScopeEnvironment(path.join(directory, 'mcp.json'))).toThrow(envPath);
    } finally {
      await chmod(envPath, 0o600);
    }
    },
  );
});
