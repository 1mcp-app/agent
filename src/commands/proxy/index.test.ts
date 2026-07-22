import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupProxyCommand } from './index.js';

const proxyCommandMock = vi.fn();
const configureGlobalLoggerMock = vi.fn();

vi.mock('./proxy.js', () => ({
  proxyCommand: proxyCommandMock,
}));

vi.mock('@src/logger/configureGlobalLogger.js', () => ({
  configureGlobalLogger: configureGlobalLoggerMock,
}));

describe('setupProxyCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers --context for named runtime target attachment', async () => {
    await setupProxyCommand(yargs([]).exitProcess(false).help(false).version(false).strict()).parseAsync([
      'proxy',
      '--context',
      'prod',
    ]);

    expect(proxyCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
  });
});
