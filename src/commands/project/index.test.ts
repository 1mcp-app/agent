import { describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupProjectCommands } from './index.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./project.js', () => ({ projectCommand: invoke }));
vi.mock('@src/commands/shared/commandRunner.js', () => ({
  runCliCommand: (args: unknown, command: (args: unknown) => unknown) => command(args),
}));

describe('project lifecycle CLI', () => {
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
