import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfiguredCommandPreparationAdapter } from './configuredCommandAdapter.js';
import type { PreparationTarget } from './contracts.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function target(prefix = 'configured-command-'): Promise<PreparationTarget> {
  const checkoutRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(checkoutRoot);
  return { checkoutRoot, backendName: 'fixture', backendIdentity: 'fixture-v1', configurationKey: 'config' };
}
const command = (source: string, args: string[] = []) => ({
  executable: process.execPath,
  args: ['-e', source, ...args],
});
describe('configured-command preparation adapter', () => {
  it('probes the selected checkout with literal argument substitutions and no shell interpretation', async () => {
    const selected = await target('configured-command-{operation} space$;-');
    const operation = 'symbols {checkout}; $(touch should-never-exist)';
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('console.log(JSON.stringify({cwd:process.cwd(), args:process.argv.slice(1)}))', [
        '{checkout}',
        '{operation}',
        'prefix:{checkout}:{operation}',
      ]),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: {},
    });
    const result = await adapter.inspect(selected, operation);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected ready');
    expect(JSON.parse(result.evidence.detail)).toEqual({
      cwd: selected.checkoutRoot,
      args: [selected.checkoutRoot, operation, `prefix:${selected.checkoutRoot}:${operation}`],
    });
  });
  it.each([
    [10, { state: 'required', action: 'initialize', instructions: 'Initialize the selected checkout.' }],
    [12, { state: 'conflict', instructions: 'A foreign writer owns the checkout.' }],
    [13, { state: 'unknown', reason: 'unmapped_exit' }],
  ])('reports explicit readiness mappings and unknown exits (%i)', async (code, expected) => {
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command(`process.exit(${code})`),
      readinessExitCodes: {
        '10': { state: 'required', action: 'initialize', instructions: 'Initialize the selected checkout.' },
        '12': { state: 'conflict', instructions: 'A foreign writer owns the checkout.' },
      },
      actions: {},
    });
    expect(await adapter.inspect(await target(), 'symbols')).toMatchObject(expected);
  });
  it('executes only the explicitly selected action and classifies transient exits from configuration', async () => {
    const selected = await target();
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(10)'),
      readinessExitCodes: { '10': { state: 'required', action: 'initialize', instructions: 'Initialize.' } },
      actions: {
        initialize: command('require("fs").writeFileSync("action",process.argv[1])', ['{operation}']),
        sync: { ...command('process.exit(75)'), transientExitCodes: [75] },
      },
    });
    await adapter.prepare(selected, 'initialize', {
      signal: new AbortController().signal,
      executionDeadlineMs: 5000,
      operation: 'symbols',
    });
    expect(await readFile(join(selected.checkoutRoot, 'action'), 'utf8')).toBe('symbols');
    const failure = await adapter
      .prepare(selected, 'sync', { signal: new AbortController().signal, executionDeadlineMs: 5000 })
      .catch((error) => adapter.classifyFailure(error));
    expect(failure).toMatchObject({ code: 'command_exit', retryable: true });
    const unsupported = await adapter
      .prepare(selected, 'rebuild', { signal: new AbortController().signal, executionDeadlineMs: 5000 })
      .catch((error) => adapter.classifyFailure(error));
    expect(unsupported).toMatchObject({ code: 'unsupported_action', retryable: false });
  });
  it('reports timed-out, unavailable, and excessive-output probes as unknown instead of readiness', async () => {
    for (const probe of [
      command('setInterval(()=>{},1000)'),
      command('console.log("x".repeat(10000))'),
      { executable: join((await target()).checkoutRoot, 'absent'), args: [] },
    ]) {
      const adapter = new ConfiguredCommandPreparationAdapter({
        containment: 'posix-process-group',
        probe,
        readinessExitCodes: { '0': { state: 'ready' } },
        actions: {},
        inspectionTimeoutMs: 200,
        outputLimitBytes: 256,
        terminationGraceMs: 20,
      });
      expect(await adapter.inspect(await target(), 'symbols')).toMatchObject({ state: 'unknown' });
    }
  });
  it('uses only validated explicitly supplied status progress and never infers percentages from logs', async () => {
    const selected = await target();
    const base = {
      containment: 'posix-process-group' as const,
      probe: command('console.log("50% done")'),
      readinessExitCodes: { '0': { state: 'ready' as const } },
      actions: {},
    };
    expect(await new ConfiguredCommandPreparationAdapter(base).progress(selected, 'symbols')).toBeUndefined();
    const adapter = new ConfiguredCommandPreparationAdapter({
      ...base,
      status: command('console.log(JSON.stringify({completed:3,total:8,unit:"files",message:"Parsing"}))'),
    });
    expect(await adapter.progress(selected, 'symbols')).toEqual({
      completed: 3,
      total: 8,
      unit: 'files',
      message: 'Parsing',
    });
    const invalid = new ConfiguredCommandPreparationAdapter({
      ...base,
      status: command('console.log(JSON.stringify({completed:9,total:8}))'),
    });
    expect(await invalid.progress(selected, 'symbols')).toBeUndefined();
  });
  it('retains ownership after leader exit, kills TERM-ignoring descendants, and leaves foreign work untouched', async () => {
    const selected = await target();
    const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
    const controller = new AbortController();
    const action = command(
      'const {spawn}=require("child_process"); const child=spawn(process.execPath,["-e",`process.on("SIGTERM",()=>{}); require("fs").writeFileSync("descendant",String(process.pid)); setInterval(()=>{},1000)`],{stdio:"ignore"}); child.unref()',
    );
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(0)'),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: { initialize: action },
      terminationGraceMs: 30,
    });
    let settled = false;
    const preparation = adapter
      .prepare(selected, 'initialize', { signal: controller.signal, executionDeadlineMs: 5000 })
      .then(
        () => {
          settled = true;
          return undefined;
        },
        (error) => {
          settled = true;
          return adapter.classifyFailure(error);
        },
      );
    try {
      await expect
        .poll(async () => readFile(join(selected.checkoutRoot, 'descendant'), 'utf8').catch(() => ''), {
          timeout: 3000,
        })
        .not.toBe('');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      controller.abort();
      expect(await preparation).toMatchObject({ code: 'cancelled', retryable: false });
      const pid = Number(await readFile(join(selected.checkoutRoot, 'descendant'), 'utf8'));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 3000 },
        )
        .toBe(false);
      expect(() => process.kill(foreign.pid!, 0)).not.toThrow();
    } finally {
      controller.abort();
      foreign.kill('SIGKILL');
      await preparation;
    }
  });
  it('rejects unsupported platform containment before any action launches', async () => {
    const selected = await target();
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(0)'),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: { initialize: command('require("fs").writeFileSync("launched","yes")') },
    });
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    const failure = await adapter
      .prepare(selected, 'initialize', { signal: new AbortController().signal, executionDeadlineMs: 5000 })
      .catch((error) => adapter.classifyFailure(error));
    expect(failure).toMatchObject({ code: 'unsupported_containment', retryable: false });
    expect(await readFile(join(selected.checkoutRoot, 'launched'), 'utf8').catch(() => undefined)).toBeUndefined();
  });
  it('recovery reprobes native readiness without treating saved running state as process ownership', async () => {
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(0)'),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: {},
    });
    const selected = await target();
    expect(
      await adapter.reconcile(selected, 'symbols', { previousJobId: 'old-runtime-job', previousState: 'running' }),
    ).toMatchObject({ state: 'ready' });
    expect(
      await adapter.reconcile(selected, 'symbols', { previousJobId: 'old-runtime-job', previousState: 'ready' }),
    ).toMatchObject({ state: 'ready' });
  });
  it('enforces the action deadline and stops its owned process', async () => {
    const selected = await target();
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(0)'),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: {
        initialize: command(
          'require("fs").writeFileSync("owned",String(process.pid)); process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)',
        ),
      },
      terminationGraceMs: 20,
    });
    const result = await adapter
      .prepare(selected, 'initialize', { signal: new AbortController().signal, executionDeadlineMs: 500 })
      .catch((error) => adapter.classifyFailure(error));
    expect(result).toMatchObject({ code: 'execution_deadline', retryable: false });
    const pid = Number(await readFile(join(selected.checkoutRoot, 'owned'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('settles safely when process inventory becomes unavailable after launch', async () => {
    const selected = await target();
    const adapter = new ConfiguredCommandPreparationAdapter({
      containment: 'posix-process-group',
      probe: command('process.exit(0)'),
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: {
        initialize: command('require("fs").writeFileSync("owned",String(process.pid)); setInterval(()=>{},1000)'),
      },
      terminationGraceMs: 20,
    });
    const controller = new AbortController();
    const pending = adapter
      .prepare(selected, 'initialize', { signal: controller.signal, executionDeadlineMs: 2000 })
      .catch((error) => adapter.classifyFailure(error));
    try {
      await expect
        .poll(async () => readFile(join(selected.checkoutRoot, 'owned'), 'utf8').catch(() => ''), { timeout: 1000 })
        .not.toBe('');
      vi.stubEnv('PATH', join(selected.checkoutRoot, 'absent-bin-directory'));
      expect(await pending).toMatchObject({ code: 'unsupported_containment', retryable: false });
      const pid = Number(await readFile(join(selected.checkoutRoot, 'owned'), 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      vi.unstubAllEnvs();
      await pending;
    }
  });
});
