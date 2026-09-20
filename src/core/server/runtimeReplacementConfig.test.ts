import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ConfigLoader } from '@src/config/configLoader.js';
import { processEnvironment, substituteEnvVars } from '@src/config/envProcessor.js';
import {
  deferUntilRuntimeActivation,
  getRuntimeParentEnvironment,
  releaseFrozenRuntimeBootstrap,
} from '@src/config/runtimeBootstrap.js';
import { loadRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';

import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateRuntimeReplacementConfig,
  captureExplicitLaunchInputs,
  installRuntimeReplacementConfig,
  prepareRuntimeReplacementConfig,
} from './runtimeReplacementConfig.js';

let directory: string;
let configFilePath: string;
const empty = { version: 1 as const, values: {} };
const prepare = () =>
  prepareRuntimeReplacementConfig({
    configFilePath,
    runtimeScope: directory,
    previousExplicitInputs: empty,
    invocationExplicitInputs: empty,
  });

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-config-test-'));
  configFilePath = path.join(directory, 'mcp.json');
  fs.writeFileSync(
    configFilePath,
    JSON.stringify({ mcpServers: { backend: { command: 'node', args: ['${RUNTIME_TEST_TOKEN}'] } } }),
  );
  fs.writeFileSync(path.join(directory, 'config.toml'), 'port = 3100');
  fs.writeFileSync(path.join(directory, '.env'), 'RUNTIME_TEST_TOKEN=first');
});

afterEach(() => {
  releaseFrozenRuntimeBootstrap();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('replacement launch provenance', () => {
  it('keeps explicit values equal to defaults, aliases, negation and environment overrides', () => {
    vi.stubEnv('ONE_MCP_HOST', '127.0.0.2');
    const captured = captureExplicitLaunchInputs(['serve', '--restart', '-P', '3050', '--no-pagination']);
    expect(captured.values.port).toBe(3050);
    expect(captured.values.pagination).toBe(false);
    expect(captured.values.host).toBe('127.0.0.2');
    expect(captured.values).not.toHaveProperty('restart');
    expect(captured.values).not.toHaveProperty('enable-auth');
    expect(captured.values).not.toHaveProperty('lazy-cache-max-entries');
  });

  it('preserves old explicit settings, overlays new explicit settings, and leaves defaults unspecified', () => {
    const result = prepareRuntimeReplacementConfig({
      configFilePath,
      runtimeScope: directory,
      previousExplicitInputs: { version: 1, values: { port: 3050, pagination: false } },
      invocationExplicitInputs: { version: 1, values: { port: 3101 } },
    });
    expect(result.effectiveOptions).toEqual({ port: 3101, pagination: false });
    expect(result.snapshot.appConfig.port).toBe(3100);
  });

  it.each([
    ['port', 99999],
    ['port', -1],
    ['port', 3050.5],
    ['session-ttl', 0],
    ['rate-limit-window', -1],
    ['rate-limit-max', 1.5],
    ['lazy-cache-max-entries', -1],
    ['config-reload-debounce', -1],
    ['async-max-concurrent-loads', 0],
    ['async-max-retries', -1],
    ['async-background-retry-interval', 999],
    ['async-batch-delay', -1],
    ['lazy-cache-ttl', -1],
    ['lazy-fallback-timeout', 0],
    ['session-persist-requests', -1],
    ['session-persist-interval', -1],
    ['session-background-flush', -1],
  ])('rejects invalid explicit %s before bootstrap', (option, value) => {
    expect(() =>
      prepareRuntimeReplacementConfig({
        configFilePath,
        runtimeScope: directory,
        previousExplicitInputs: empty,
        invocationExplicitInputs: { version: 1, values: { [option]: value } },
      }),
    ).toThrow('configuration is invalid');
  });

  it('retains a custom config filename and permits an explicit file override inside the same scope', () => {
    const custom = path.join(directory, 'custom.json');
    fs.writeFileSync(custom, '{"mcpServers":{}}');
    const retained = prepareRuntimeReplacementConfig({
      configFilePath,
      runtimeScope: directory,
      previousExplicitInputs: { version: 1, values: { config: custom } },
      invocationExplicitInputs: empty,
    });
    expect(retained.snapshot.configFilePath).toBe(custom);
    const overridden = prepareRuntimeReplacementConfig({
      configFilePath,
      runtimeScope: directory,
      previousExplicitInputs: { version: 1, values: { config: custom } },
      invocationExplicitInputs: { version: 1, values: { config: configFilePath } },
    });
    expect(overridden.snapshot.configFilePath).toBe(configFilePath);
  });

  it('rejects scope changes before any bootstrap state is installed', () => {
    expect(() =>
      prepareRuntimeReplacementConfig({
        configFilePath,
        runtimeScope: directory,
        previousExplicitInputs: empty,
        invocationExplicitInputs: { version: 1, values: { 'config-dir': os.tmpdir() } },
      }),
    ).toThrow('configuration is invalid');
  });
});

describe('frozen replacement bootstrap', () => {
  it.each([
    ['mcp.json', '{ secret-invalid-json'],
    ['mcp.json', '{"mcpServers":{"bad":{"command":42}}}'],
    ['mcp.json', '{"mcpServers":{},"serverDefaults":{"timeout":"not-a-number"}}'],
    ['config.toml', 'port = "secret-invalid-port"'],
    ['config.toml', '[broken'],
    ['.env', 'secret-invalid-line'],
  ])('strictly rejects malformed %s without leaking content', (file, content) => {
    fs.writeFileSync(path.join(directory, file), content);
    expect(prepare).toThrow('Runtime replacement configuration is invalid');
    try {
      prepare();
    } catch (error) {
      expect(String(error)).not.toContain('secret-invalid');
    }
  });

  it('uses exactly the prepared MCP, app, scope env and parent env despite subsequent edits', () => {
    vi.stubEnv('PARENT_RUNTIME_TEST_TOKEN', 'parent-first');
    const result = prepare();
    fs.writeFileSync(configFilePath, '{"mcpServers":{}}');
    fs.writeFileSync(path.join(directory, 'config.toml'), 'port = 3200');
    fs.writeFileSync(path.join(directory, '.env'), 'RUNTIME_TEST_TOKEN=second');
    vi.stubEnv('PARENT_RUNTIME_TEST_TOKEN', 'parent-second');
    installRuntimeReplacementConfig(result.snapshot, result.digest, directory);
    const loader = new ConfigLoader(configFilePath);
    expect(loader.loadAppConfigFromToml().port).toBe(3100);
    expect(loader.loadConfigWithEnvSubstitution().backend.command).toBe('node');
    expect(loadRuntimeScopeEnvironment(configFilePath).RUNTIME_TEST_TOKEN).toBe('first');
    expect(substituteEnvVars('${PARENT_RUNTIME_TEST_TOKEN}')).toBe('parent-first');
    expect(processEnvironment({ env: ['PARENT_RUNTIME_TEST_TOKEN'] }).processedEnv.PARENT_RUNTIME_TEST_TOKEN).toBe(
      'parent-first',
    );
    const resumed = vi.fn();
    expect(deferUntilRuntimeActivation(resumed)).toBe(true);
    expect(resumed).not.toHaveBeenCalled();
    expect(() => activateRuntimeReplacementConfig('wrong')).toThrow('digest mismatch');
    activateRuntimeReplacementConfig(result.digest);
    expect(resumed).toHaveBeenCalledOnce();
    expect(loader.loadAppConfigFromToml().port).toBe(3200);
    expect(loader.loadConfigWithEnvSubstitution()).toEqual({});
    // Later lazy/recreated transports retain the invoking installation's parent environment.
    expect(getRuntimeParentEnvironment().PARENT_RUNTIME_TEST_TOKEN).toBe('parent-first');
  });

  it('a separately launched worker consumes frozen bootstrap over private IPC', async () => {
    const result = prepare();
    const fixture = path.join(directory, 'worker.mjs');
    await build({
      stdin: {
        contents: `
        import { installRuntimeReplacementConfig } from '${path.resolve('src/core/server/runtimeReplacementConfig.ts')}';
        import { ConfigLoader } from '${path.resolve('src/config/configLoader.ts')}';
        import { loadRuntimeScopeEnvironment } from '${path.resolve('src/config/runtimeScopeEnv.ts')}';
        import { substituteEnvVars } from '${path.resolve('src/config/envProcessor.ts')}';
        process.once('message', ({snapshot, digest, scope}) => {
          installRuntimeReplacementConfig(snapshot, digest, scope);
          const loader = new ConfigLoader(snapshot.configFilePath);
          const backend = loader.loadConfigWithEnvSubstitution().backend;
          process.send({port: loader.loadAppConfigFromToml().port,
            argument: substituteEnvVars(backend.args[0], loadRuntimeScopeEnvironment(snapshot.configFilePath))},
            () => process.disconnect());
        });
      `,
        resolveDir: process.cwd(),
      },
      outfile: fixture,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      // Resolve package imports from the repository rather than the temporary fixture directory.
      plugins: [
        {
          name: 'external-packages',
          setup(builder) {
            builder.onResolve({ filter: /^[^./]/ }, (args) => {
              if (args.path.startsWith('@src/')) return;
              if (
                args.path.startsWith('node:') ||
                ['fs', 'path', 'events', 'crypto', 'os', 'url', 'util'].includes(args.path)
              )
                return;
              return { path: import.meta.resolve(args.path), external: true };
            });
          },
        },
      ],
    });
    fs.writeFileSync(configFilePath, '{"mcpServers":{}}');
    fs.writeFileSync(path.join(directory, 'config.toml'), 'port = 3200');
    fs.writeFileSync(path.join(directory, '.env'), 'RUNTIME_TEST_TOKEN=second');
    const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let diagnostic = '';
    child.stderr?.on('data', (chunk) => {
      diagnostic += String(chunk);
    });
    try {
      const response = new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Fixture failed: ${diagnostic}`));
        });
      });
      child.send({ snapshot: result.snapshot, digest: result.digest, scope: directory });
      expect(await response).toEqual({ port: 3100, argument: 'first' });
    } finally {
      child.kill();
    }
  });

  it('rejects corrupted bootstrap and a mismatched scope', () => {
    const result = prepare();
    expect(() => installRuntimeReplacementConfig(result.snapshot, 'wrong', directory)).toThrow('digest mismatch');
    expect(() => installRuntimeReplacementConfig(result.snapshot, result.digest, os.tmpdir())).toThrow(
      'scope mismatch',
    );
    result.snapshot.appConfig.port = 3200;
    expect(() => installRuntimeReplacementConfig(result.snapshot, result.digest, directory)).toThrow('digest mismatch');
  });
});
