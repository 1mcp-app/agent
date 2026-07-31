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

  it('passes preset as a yargs option for ONE_MCP_PRESET env parsing', async () => {
    await setupServeCommand(yargs([]).exitProcess(false).help(false).version(false)).parseAsync([
      'serve',
      '--preset=production',
    ]);

    expect(serveCommandMock).toHaveBeenCalledWith(expect.objectContaining({ preset: 'production' }));
  });

  it('passes the canonical async snapshot notification flag through', async () => {
    await setupServeCommand(yargs([]).exitProcess(false).help(false).version(false)).parseAsync([
      'serve',
      '--no-async-notify-on-snapshot',
    ]);

    expect(serveCommandMock).toHaveBeenCalledWith(expect.objectContaining({ 'async-notify-on-snapshot': false }));
  });

  it('passes deprecated async environment inputs through for warning handling', async () => {
    const previousValue = process.env.ONE_MCP_ASYNC_MIN_SERVERS;
    process.env.ONE_MCP_ASYNC_MIN_SERVERS = '7';
    try {
      await setupServeCommand(yargs([]).env('ONE_MCP').exitProcess(false).help(false).version(false)).parseAsync([
        'serve',
      ]);

      expect(serveCommandMock).toHaveBeenCalledWith(expect.objectContaining({ 'async-min-servers': 7 }));
    } finally {
      if (previousValue === undefined) delete process.env.ONE_MCP_ASYNC_MIN_SERVERS;
      else process.env.ONE_MCP_ASYNC_MIN_SERVERS = previousValue;
    }
  });
});
