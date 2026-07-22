import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupInspectCommand } from './index.js';

const inspectCommandMock = vi.fn();
const configureGlobalLoggerMock = vi.fn();

vi.mock('./inspect.js', () => ({
  inspectCommand: inspectCommandMock,
}));

vi.mock('@src/logger/configureGlobalLogger.js', () => ({
  configureGlobalLogger: configureGlobalLoggerMock,
}));

describe('setupInspectCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers --context for named runtime target attachment', async () => {
    await setupInspectCommand(yargs([]).exitProcess(false).help(false).version(false).strict()).parseAsync([
      'inspect',
      '--context',
      'prod',
    ]);

    expect(inspectCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
  });
});
