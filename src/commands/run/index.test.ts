import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupRunCommand } from './index.js';

const runCommandMock = vi.fn();
const configureGlobalLoggerMock = vi.fn();

vi.mock('./run.js', () => ({
  runCommand: runCommandMock,
}));

vi.mock('@src/logger/configureGlobalLogger.js', () => ({
  configureGlobalLogger: configureGlobalLoggerMock,
}));

describe('setupRunCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('accepts an explicit tool deadline and the normal environment override', async () => {
    const parser = () =>
      setupRunCommand(yargs([]).env('ONE_MCP').exitProcess(false).help(false).version(false).strict());
    await parser().parseAsync(['run', 'filesystem/read_file', '--timeout-ms', '120000']);
    expect(runCommandMock).toHaveBeenLastCalledWith(expect.objectContaining({ 'timeout-ms': 120000 }));

    vi.stubEnv('ONE_MCP_TIMEOUT_MS', '45000');
    await parser().parseAsync(['run', 'filesystem/read_file']);
    expect(runCommandMock).toHaveBeenLastCalledWith(expect.objectContaining({ 'timeout-ms': 45000 }));
  });

  it('registers --context for named runtime target attachment', async () => {
    await setupRunCommand(yargs([]).exitProcess(false).help(false).version(false).strict()).parseAsync([
      'run',
      'filesystem/read_file',
      '--context',
      'prod',
    ]);

    expect(runCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
  });
});
