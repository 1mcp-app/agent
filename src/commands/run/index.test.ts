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
