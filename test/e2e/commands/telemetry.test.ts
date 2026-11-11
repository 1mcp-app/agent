import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('local telemetry controls in an unconditionally suppressed CLI', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;
  let home: string;
  let installation: string;
  const options = () => ({ envOverrides: { HOME: home, USERPROFILE: home } });
  beforeAll(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('telemetry', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
    home = path.join(environment.getTempDir(), 'telemetry-home');
    await mkdir(home, { mode: 0o700 });
    installation = path.join(
      home,
      process.platform === 'win32' ? 'AppData/Roaming/1mcp/product-telemetry' : '.config/1mcp/product-telemetry',
    );
  });
  afterAll(async () => environment.cleanup());
  it('help, version and absent status create no installation state', async () => {
    for (const args of [['--help'], ['--version'], ['telemetry', '--help'], ['inspect', '--help']]) {
      const result = await runner.runCommand(args[0], '', { ...options(), args: args.slice(1) });
      runner.assertSuccess(result);
      expect(result.stderr).toBe('');
    }
    const status = await runner.runCommand('telemetry', 'status', { ...options(), args: ['--json'] });
    runner.assertSuccess(status);
    expect(JSON.parse(status.stdout)).toMatchObject({
      preference: 'default',
      identityPresent: false,
      queuedSummaries: 0,
      collectionEnabled: false,
      recovery: 'not-needed',
    });
    await expect(stat(installation)).rejects.toThrow();
  });
  it('persists controls locally despite remote selection and never self-counts or creates a UUID', async () => {
    for (const [action, preference] of [
      ['disable', 'disabled'],
      ['reset', 'disabled'],
      ['enable', 'enabled'],
      ['reset', 'enabled'],
    ]) {
      const result = await runner.runCommand('telemetry', action, {
        ...options(),
        args: [
          '--json',
          '--context',
          'does-not-exist',
          '--url',
          'http://127.0.0.1:1/mcp',
          '--product-telemetry=true',
          '--product-telemetry-ci=true',
          '--product-telemetry-test-suppressed=false',
        ],
      });
      runner.assertSuccess(result);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        preference,
        identityPresent: false,
        queuedSummaries: 0,
        collectionEnabled: false,
      });
    }
    const state = JSON.parse(await readFile(path.join(installation, 'state.json'), 'utf8'));
    expect(state.installationId).toBeUndefined();
    expect(state.queue).toEqual([]);
    expect(state.noticed).toBe(false);
  });
  it('reports blocked ownership and offline guidance without changing installation state', async () => {
    const before = await readFile(path.join(installation, 'state.json'), 'utf8');
    await mkdir(path.join(installation, 'guard'), { mode: 0o700 });
    const status = await runner.runCommand('telemetry', 'status', { ...options(), args: ['--json'] });
    runner.assertSuccess(status);
    expect(JSON.parse(status.stdout)).toMatchObject({
      coordination: 'busy-or-ambiguous',
      recovery: 'offline-required',
      identityPresent: false,
    });
    const text = await runner.runCommand('telemetry', 'status', options());
    runner.assertSuccess(text);
    expect(text.stdout).toContain('Recovery: offline-required');
    expect(text.stdout).toContain('Stop all local 1MCP producers before offline repair; preserve state.json');
    expect(await readFile(path.join(installation, 'state.json'), 'utf8')).toBe(before);
    expect((await stat(path.join(installation, 'guard'))).isDirectory()).toBe(true);
  });
});
