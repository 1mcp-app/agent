import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupProjectCommands } from './index.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./project.js', () => ({ projectCommand: invoke }));
vi.mock('@src/commands/shared/commandRunner.js', () => ({
  runCliCommand: (args: unknown, command: (args: unknown) => unknown) => command(args),
}));

describe('project lifecycle CLI', () => {
  it.each(['release', 'drain', 'status', 'resume', 'recover'])(
    'advertises a wait budget only for drain (%s)',
    async (action) => {
      let output = '';
      await setupProjectCommands(yargs([]).exitProcess(false).help()).parseAsync(
        ['project', action, '--help'],
        {},
        (_error, _argv, help) => {
          output = help;
        },
      );
      expect(output.includes('--wait-ms')).toBe(action === 'drain');
      if (action === 'recover') {
        for (const option of ['--url', '--context', '--preset', '--tags', '--tag-filter']) {
          expect(output).not.toContain(option);
        }
      }
    },
  );

  it.each(['release', 'status', 'resume', 'recover'])('rejects a wait budget before invoking %s', async (action) => {
    invoke.mockClear();
    await expect(async () =>
      setupProjectCommands(yargs([]).exitProcess(false).strict())
        .showHelpOnFail(false)
        .parseAsync(['project', action, '--wait-ms', '5000']),
    ).rejects.toThrow('Unknown argument');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('passes the drain wait budget to the handler', async () => {
    invoke.mockClear();
    await setupProjectCommands(yargs([]).exitProcess(false).strict()).parseAsync([
      'project',
      'drain',
      '--wait-ms',
      '5000',
    ]);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action: 'drain', 'wait-ms': 5000 }));
  });

  it.each(['--url', '--context', '--preset', '--tags', '--tag-filter'])(
    'rejects a per-call selector for recorded recovery (%s)',
    async (option) => {
      invoke.mockClear();
      await expect(async () =>
        setupProjectCommands(yargs([]).exitProcess(false).strict())
          .showHelpOnFail(false)
          .parseAsync(['project', 'recover', option, 'other']),
      ).rejects.toThrow('Unknown argument');
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['release', 'drain', 'status', 'resume'])(
    'registers project %s with selection and structured output',
    async (action) => {
      invoke.mockClear();
      await setupProjectCommands(yargs())
        .exitProcess(false)
        .strict()
        .parseAsync(['project', action, '--project', '/checkout', '--format', 'json']);
      expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action, project: ['/checkout'], format: 'json' }));
    },
  );
});
