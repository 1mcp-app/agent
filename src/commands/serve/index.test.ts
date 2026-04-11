import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupServeCommand } from './index.js';

const serveCommandMock = vi.fn();
const configureGlobalLoggerMock = vi.fn();

vi.mock('./serve.js', () => ({
  serveCommand: serveCommandMock,
}));

vi.mock('@src/logger/configureGlobalLogger.js', () => ({
  configureGlobalLogger: configureGlobalLoggerMock,
}));

describe('setupServeCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not inject an HTTP transport when no CLI transport flag is passed', async () => {
    await setupServeCommand(yargs([]).exitProcess(false).help(false).version(false)).parseAsync(['serve']);

    expect(configureGlobalLoggerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: undefined,
        'config-dir': undefined,
        'log-file': undefined,
      }),
      undefined,
    );
    expect(serveCommandMock).toHaveBeenCalledTimes(1);
    expect(serveCommandMock.mock.calls[0]?.[0]).not.toHaveProperty('transport');
  });

  it('passes the CLI transport through when explicitly provided', async () => {
    await setupServeCommand(yargs([]).exitProcess(false).help(false).version(false)).parseAsync([
      'serve',
      '--transport=stdio',
    ]);

    expect(configureGlobalLoggerMock).toHaveBeenCalledWith(expect.any(Object), 'stdio');
    expect(serveCommandMock).toHaveBeenCalledWith(expect.objectContaining({ transport: 'stdio' }));
  });
});
