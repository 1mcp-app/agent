import { runServeRestart } from '@src/commands/serve/serveRestart.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServeOptions } from './serve.js';

/**
 * `runServeRestart` is a thin composition of `runServeStop` then
 * `runServeBackground`, coordinating through `process.exitCode`. These tests
 * inject both phases to assert ordering and the stop-failure short-circuit.
 */
describe('runServeRestart', () => {
  let stderr: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  // Only `config-dir` is read by the handler; the rest is irrelevant to routing.
  const argv = { 'config-dir': '/scope' } as ServeOptions;

  beforeEach(() => {
    stderr = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderr += String(chunk);
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('stops then starts a fresh background runtime', async () => {
    const calls: string[] = [];
    const runStop = vi.fn(async () => {
      calls.push('stop');
      process.exitCode = 0;
    });
    const runBackground = vi.fn(async () => {
      calls.push('background');
      process.exitCode = 0;
    });

    await runServeRestart(argv, { runStop, runBackground });

    expect(runStop).toHaveBeenCalledWith('/scope');
    expect(runBackground).toHaveBeenCalledWith(argv);
    expect(calls).toEqual(['stop', 'background']);
    expect(process.exitCode).toBe(0);
  });

  it('still starts a runtime when nothing was running (no-op stop)', async () => {
    // runServeStop exits 0 with no kill when the scope is empty.
    const runStop = vi.fn(async () => {
      process.exitCode = 0;
    });
    const runBackground = vi.fn(async () => {
      process.exitCode = 0;
    });

    await runServeRestart(argv, { runStop, runBackground });

    expect(runBackground).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it('aborts without starting when the stop phase fails', async () => {
    const runStop = vi.fn(async () => {
      process.exitCode = 1;
    });
    const runBackground = vi.fn();

    await runServeRestart(argv, { runStop, runBackground });

    expect(runBackground).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('restart aborted');
  });

  it('propagates a background-start failure', async () => {
    const runStop = vi.fn(async () => {
      process.exitCode = 0;
    });
    const runBackground = vi.fn(async () => {
      process.exitCode = 1;
    });

    await runServeRestart(argv, { runStop, runBackground });

    expect(runBackground).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
});
