import { beginProductCommand } from '@src/productTelemetry/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupServeCommand } from './index.js';
import { serveCommand } from './serve.js';

const usage = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@src/productTelemetry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/productTelemetry/index.js')>()),
  beginProductCommand: vi.fn(() => usage),
}));
vi.mock('./serve.js', () => ({ serveCommand: vi.fn(async () => {}) }));

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});
describe('serve short controls retain startup ownership', () => {
  it.each(['status', 'stop'])('counts --%s completion once', async (flag) => {
    await setupServeCommand(yargs().exitProcess(false)).parseAsync(['serve', `--${flag}`]);
    expect(beginProductCommand).toHaveBeenCalledExactlyOnceWith('serve');
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it.each([{ flags: [] }, { flags: ['--background'] }, { flags: ['--restart'] }])(
    'leaves $flags startup to lifecycle owner',
    async ({ flags }) => {
      await setupServeCommand(yargs().exitProcess(false)).parseAsync(['serve', ...flags]);
      expect(serveCommand).toHaveBeenCalledOnce();
      expect(beginProductCommand).not.toHaveBeenCalled();
    },
  );
  it('preserves a control failure status', async () => {
    vi.mocked(serveCommand).mockImplementationOnce(async () => {
      process.exitCode = 1;
    });
    await setupServeCommand(yargs().exitProcess(false)).parseAsync(['serve', '--stop']);
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
});
