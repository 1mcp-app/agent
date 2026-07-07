import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupInstructionsCommand } from './index.js';

const instructionsCommandMock = vi.fn();
const configureGlobalLoggerMock = vi.fn();

vi.mock('./instructions.js', () => ({
  instructionsCommand: instructionsCommandMock,
}));

vi.mock('@src/logger/configureGlobalLogger.js', () => ({
  configureGlobalLogger: configureGlobalLoggerMock,
}));

describe('setupInstructionsCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers --context for named runtime target attachment', async () => {
    await setupInstructionsCommand(yargs([]).exitProcess(false).help(false).version(false).strict()).parseAsync([
      'instructions',
      '--context',
      'prod',
    ]);

    expect(instructionsCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
  });
});
